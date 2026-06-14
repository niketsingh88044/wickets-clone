// Settlement engine — turns OPEN markets into SETTLED ones, computes win/lose
// for every bet on that market, and credits/debits wallets accordingly.
//
// Two cadences:
//   - FANCY (Ball By Ball): settles every ~BBB_INTERVAL_MS, then immediately
//     spawns a new ball market so the user has a continuous stream of bets.
//   - MATCH_ODDS / BOOKMAKER: settle once the match has been in-play long
//     enough (MATCH_SETTLE_AGE_MS). When both settle, the match is finished.
//
// Winner selection is weighted by 1/odds (favourite wins more often).
// Ball-by-ball uses a realistic discrete distribution.

import { EventEmitter } from "events";
import { prisma } from "./prisma";
import { loadRunnerPools } from "./poolPricing";

const BBB_INTERVAL_MS = 18_000;            // settle one "ball" every ~18s
const MATCH_SETTLE_AGE_MS = 30 * 60_000;   // 30 minutes in-play → settle main markets

type SettleEvent = {
  marketId: string;
  matchId: string;
  marketName: string;
  winnerRunnerId: string;
  winnerName: string;
  ts: number;
};

class SettlementEngine extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (this.timer) return;
    console.log(`[settlement] starting, tick=5s`);
    this.timer = setInterval(
      () => this.cycle().catch(e => console.error("[settlement]", e)),
      5_000
    );
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async cycle() {
    await this.sweepOrphanedBets();        // catch up any bets stuck on closed markets
    await this.settleEligibleFancy();
    await this.settleEligibleMainMarkets();
    // Top up the in-play slate after settlements may have finished matches.
    // Lazy import to avoid a circular dep at module load time.
    if (process.env.DISABLE_AUTO_SLATE !== "1") {
      const { ensureSlate } = await import("./fixtureGenerator");
      await ensureSlate();
    }
  }

  // If a market was closed without settling (e.g. match retired by the promote
  // job, or a market was force-closed), its OPEN bets are orphans. Void them:
  // refund the liability to balance, decrement exposure.
  //
  // SUSPENDED is intentionally NOT swept here — that status means "no new bets
  // but existing bets ride through until we know the outcome" (used by the
  // livescore integrity rule on in-progress real matches).
  async sweepOrphanedBets() {
    const orphans = await prisma.bet.findMany({
      where: {
        status: "OPEN",
        market: { status: "CLOSED" },
      },
      select: { id: true, userId: true, liability: true, marketId: true, market: { select: { name: true } } },
    });
    for (const b of orphans) {
      await prisma.$transaction([
        prisma.wallet.update({
          where: { userId: b.userId },
          data: {
            balance: { increment: b.liability },
            exposure: { decrement: b.liability },
          },
        }),
        prisma.bet.update({
          where: { id: b.id },
          data: { status: "VOID", pnl: 0, settledAt: new Date() },
        }),
        prisma.transaction.create({
          data: {
            userId: b.userId,
            amount: b.liability,
            type: "BET_VOID_REFUND",
            note: `bet voided (market "${b.market.name}" closed without settlement) — refunded ${b.liability}`,
            refId: b.id,
          },
        }),
      ]);
    }
    if (orphans.length > 0) {
      console.log(`[settlement] voided ${orphans.length} orphan bet(s) on closed markets`);
    }
  }

  // Settle every OPEN market on a match with a random winner — used when a
  // match finishes (so the FANCY in-cycle market also resolves).
  async forceSettleMatchMarkets(matchId: string) {
    const open = await prisma.market.findMany({
      where: { matchId, status: "OPEN" },
      include: { runners: { orderBy: { sortOrder: "asc" } } },
    });
    for (const m of open) {
      const winner = m.type === "FANCY"
        ? pickBallByBallWinner(m.runners)
        : pickWeightedByOdds(m.runners);
      if (winner) await this.settleMarket(m.id, winner.id);
    }
  }

  // ---- Ball-By-Ball cycling ----
  async settleEligibleFancy() {
    const cutoff = new Date(Date.now() - BBB_INTERVAL_MS);
    const due = await prisma.market.findMany({
      where: {
        type: "FANCY",
        status: "OPEN",
        match: { inPlay: true },
        createdAt: { lte: cutoff },
      },
      include: { runners: { orderBy: { sortOrder: "asc" } }, match: { select: { id: true } } },
    });

    for (const m of due) {
      const winner = pickBallByBallWinner(m.runners);
      if (!winner) continue;
      await this.settleMarket(m.id, winner.id);

      // Spawn a fresh ball market with the same runner template so the user
      // can keep betting on the next ball.
      await prisma.market.create({
        data: {
          matchId: m.match.id,
          name: m.name,
          type: m.type,
          minStake: m.minStake,
          maxStake: m.maxStake,
          runners: {
            create: m.runners.map(r => ({
              name: r.name,
              sortOrder: r.sortOrder,
              backOdds: r.backOdds,
              backSize: r.backSize,
              layOdds: r.layOdds,
              laySize: r.laySize,
            })),
          },
        },
      });
    }
  }

  // ---- Match Odds / Bookmaker settlement ----
  async settleEligibleMainMarkets() {
    const cutoff = new Date(Date.now() - MATCH_SETTLE_AGE_MS);
    const due = await prisma.market.findMany({
      where: {
        type: { in: ["MATCH_ODDS", "BOOKMAKER"] },
        status: "OPEN",
        match: { inPlay: true, startTime: { lt: cutoff } },
      },
      include: { runners: { orderBy: { sortOrder: "asc" } } },
    });

    for (const m of due) {
      const winner = pickWeightedByOdds(m.runners);
      if (!winner) continue;
      await this.settleMarket(m.id, winner.id);
    }

    // If all main markets on a match are SETTLED, finish the match.
    const candidates = await prisma.match.findMany({
      where: { inPlay: true, startTime: { lt: cutoff } },
      include: { markets: { select: { type: true, status: true } } },
    });
    for (const match of candidates) {
      const main = match.markets.filter(x =>
        x.type === "MATCH_ODDS" || x.type === "BOOKMAKER"
      );
      if (main.length > 0 && main.every(x => x.status === "SETTLED")) {
        // First settle any other OPEN markets (e.g. the current FANCY ball)
        // so their bets resolve cleanly instead of becoming orphans.
        await this.forceSettleMatchMarkets(match.id);
        await prisma.match.update({
          where: { id: match.id },
          data: { inPlay: false },
        });
        console.log(`[settlement] match ${match.id} finished — all markets resolved`);
      }
    }
  }

  // ---- The core: pari-mutuel settlement ------------------------------------
  // Per runner R in the market:
  //   pool[R] = back_stake[R] + lay_stake[R]
  //   if R wins  → BACK bettors on R share pool[R] proportional to stake
  //   if R loses → LAY  bettors on R share pool[R] proportional to stake
  //   if one side has no bets → opposing side is refunded (no opposing party
  //     to lose to; coin integrity demands the stake comes back).
  //
  // Coin integrity (per runner): money out exactly equals money in.
  // The market's `result` field stores the winner runner id.
  async settleMarket(marketId: string, winnerRunnerId: string) {
    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: {
        bets: { where: { status: "OPEN" } },
        match: { select: { id: true } },
        runners: { select: { id: true, name: true } },
      },
    });
    if (!market) return;

    const winner = market.runners.find(r => r.id === winnerRunnerId);
    if (!winner) return;

    // Build per-runner pool snapshot from the OPEN bets on this market.
    const pools = await loadRunnerPools(market.id);

    await prisma.$transaction(async (tx) => {
      await tx.market.update({
        where: { id: market.id },
        data: { status: "SETTLED", result: winnerRunnerId },
      });

      for (const bet of market.bets) {
        const pool = pools.get(bet.runnerId);
        const backStake = pool?.backStake ?? 0;
        const layStake  = pool?.layStake  ?? 0;
        const poolSum   = backStake + layStake;
        const runnerWon = bet.runnerId === winnerRunnerId;

        // Decide outcome for this single bet.
        let kind: "WON" | "LOST" | "REFUND";
        let payout: number;

        if (backStake === 0 || layStake === 0) {
          // One side has no opposing party → refund every bet on this runner.
          kind = "REFUND";
          payout = bet.stake;
        } else if (bet.side === "BACK") {
          if (runnerWon) {
            kind = "WON";
            // share of pool proportional to stake within winning side
            payout = (bet.stake / backStake) * poolSum;
          } else {
            kind = "LOST";
            payout = 0;
          }
        } else {
          // LAY bet
          if (!runnerWon) {
            kind = "WON";
            payout = (bet.stake / layStake) * poolSum;
          } else {
            kind = "LOST";
            payout = 0;
          }
        }

        // Apply wallet effect.
        if (kind === "WON") {
          await tx.wallet.update({
            where: { userId: bet.userId },
            data: {
              balance: { increment: payout },
              exposure: { decrement: bet.stake },
            },
          });
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: "WON", pnl: payout - bet.stake, settledAt: new Date() },
          });
          await tx.transaction.create({
            data: {
              userId: bet.userId,
              amount: payout,
              type: "BET_PAYOUT",
              note: `WON ${bet.side} ${winner.name} on "${market.name}" — payout ${payout.toFixed(2)} (pari-mutuel: stake ${bet.stake} of ${bet.side === "BACK" ? backStake : layStake} winning side, pool ${poolSum})`,
              refId: bet.id,
            },
          });
        } else if (kind === "REFUND") {
          await tx.wallet.update({
            where: { userId: bet.userId },
            data: {
              balance: { increment: payout },
              exposure: { decrement: bet.stake },
            },
          });
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: "VOID", pnl: 0, settledAt: new Date() },
          });
          await tx.transaction.create({
            data: {
              userId: bet.userId,
              amount: payout,
              type: "BET_VOID_REFUND",
              note: `REFUND ${bet.side} on "${market.name}" — no opposing pool, stake ${bet.stake} returned`,
              refId: bet.id,
            },
          });
        } else {
          // LOST — stake was debited at placement, just release exposure.
          await tx.wallet.update({
            where: { userId: bet.userId },
            data: { exposure: { decrement: bet.stake } },
          });
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: "LOST", pnl: -bet.stake, settledAt: new Date() },
          });
          await tx.transaction.create({
            data: {
              userId: bet.userId,
              amount: 0,
              type: "BET_SETTLED_LOSS",
              note: `LOST ${bet.side} on "${market.name}" — stake ${bet.stake} forfeited to winning side`,
              refId: bet.id,
            },
          });
        }
      }
    });

    const ev: SettleEvent = {
      marketId: market.id,
      matchId: market.match.id,
      marketName: market.name,
      winnerRunnerId,
      winnerName: winner.name,
      ts: Date.now(),
    };
    this.emit("market-settled", ev);
    this.emit(`market-settled:${market.id}`, ev);
    console.log(`[settlement] ${market.name} settled (pari-mutuel), winner=${winner.name}, bets=${market.bets.length}`);
  }
}

// ----- Weighted pickers -----

function pickWeightedByOdds(runners: { id: string; backOdds: number | null }[]) {
  const valid = runners.filter(r => r.backOdds && r.backOdds > 0);
  if (!valid.length) return null;
  const weights = valid.map(r => 1 / (r.backOdds as number));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < valid.length; i++) {
    r -= weights[i];
    if (r <= 0) return valid[i];
  }
  return valid[valid.length - 1];
}

// Realistic per-ball outcome distribution for T20/ODI cricket (approximate).
const BBB_PROBS: Record<string, number> = {
  "0 RUNS":     0.42,
  "1 RUNS":     0.30,
  "2 RUNS":     0.08,
  "3 RUNS":     0.01,
  "4 RUNS":     0.09,
  "6 RUNS":     0.04,
  "WICKET":     0.03,
  "EXTRA RUNS": 0.03,
};

function pickBallByBallWinner(runners: { id: string; name: string }[]) {
  // Build weights per matched name; fall back to 1/n for unknown names.
  const weights = runners.map(r => BBB_PROBS[r.name] ?? 1 / runners.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < runners.length; i++) {
    r -= weights[i];
    if (r <= 0) return runners[i];
  }
  return runners[runners.length - 1];
}

export const settlementEngine = new SettlementEngine();
export type { SettleEvent };
