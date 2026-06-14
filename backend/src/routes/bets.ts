import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { loadRunnerPools, ratePostTrade } from "../poolPricing";
import { oddsEngine } from "../oddsEngine";

const router = Router();

// Pari-mutuel placement.
//   liability = stake (no leverage; you risk what you stake)
//   The `odds` field on the bet stores the post-trade rate as it stood at
//   placement — useful for history display, but NOT the authority for payout.
//   Actual payout is recomputed at settlement against the *final* pool.
const placeBetSchema = z.object({
  marketId: z.string(),
  runnerId: z.string(),
  side: z.enum(["BACK", "LAY"]),
  stake: z.number().positive(),
  // odds is accepted for backward compatibility but ignored — the rate is
  // pool-derived, not bettor-chosen.
  odds: z.number().positive().optional(),
});

router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = placeBetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { marketId, runnerId, side, stake } = parsed.data;

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { runners: true },
  });
  if (!market) return res.status(404).json({ error: "market not found" });
  if (market.status !== "OPEN") return res.status(400).json({ error: `market is ${market.status}` });

  const runner = market.runners.find(r => r.id === runnerId);
  if (!runner) return res.status(404).json({ error: "runner not found" });

  if (stake < market.minStake) return res.status(400).json({ error: `min stake is ${market.minStake}` });
  if (stake > market.maxStake) return res.status(400).json({ error: `max stake is ${market.maxStake}` });

  // Snapshot the rate the bettor sees right now (post-trade, including their
  // own stake). It's stored for display only — settlement uses the final pool.
  const pools = await loadRunnerPools(marketId);
  const cur = pools.get(runnerId) ?? { backStake: 0, layStake: 0 };
  const placementRate = ratePostTrade(side, stake, cur.backStake, cur.layStake);
  const liability = stake;
  const potentialPayout = stake * placementRate;

  try {
    const bet = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: req.userId! } });
      if (!wallet) throw new Error("wallet missing");
      if (wallet.balance < liability) throw new Error("insufficient balance");

      await tx.wallet.update({
        where: { userId: req.userId! },
        data: {
          balance: { decrement: liability },
          exposure: { increment: liability },
        },
      });

      const newBet = await tx.bet.create({
        data: {
          userId: req.userId!,
          marketId,
          runnerId,
          side,
          odds: placementRate,
          stake,
          liability,
          potentialPayout,
        },
      });

      await tx.transaction.create({
        data: {
          userId: req.userId!,
          amount: -liability,
          type: "BET_STAKE",
          note: `${side} ${runner.name} @ rate ${placementRate.toFixed(2)} (pari-mutuel)`,
          refId: newBet.id,
        },
      });

      return newBet;
    });

    // Fire-and-forget: refresh the displayed rates for this market so other
    // clients see the new pool composition immediately (don't wait for the
    // periodic 3s odds-engine tick).
    oddsEngine.recalcMarket(marketId).catch(e => console.error("[bets] recalc:", e));

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
    res.json({ bet, balance: wallet!.balance, exposure: wallet!.exposure });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/history", requireAuth, async (req: AuthedRequest, res) => {
  const bets = await prisma.bet.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      runner: { select: { name: true } },
      market: { select: { name: true, match: { select: { name: true } } } },
    },
  });
  res.json(bets);
});

export default router;
