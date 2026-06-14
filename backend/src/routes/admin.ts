import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth";
import { generateSlate } from "../fixtureGenerator";
import { addSubscription, removeSubscription, listSubscriptions, syncMatch } from "../indiaTodayIngester";
import { settlementEngine } from "../settlementEngine";

const router = Router();

const credSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._@+-]+$/, "username may contain letters, numbers, and . _ @ + -"),
  password: z.string().min(6).max(72),
});

// ----- Create child account -----
// SUPER_MASTER may create MASTER or USER; MASTER may create USER only.
router.post("/create-account", requireAuth, requireRole("SUPER_MASTER", "MASTER"), async (req: AuthedRequest, res) => {
  const schema = credSchema.extend({
    role: z.enum(["USER", "MASTER"]).default("USER"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { username, password, role } = parsed.data;

  if (role === "MASTER" && req.role !== "SUPER_MASTER") {
    return res.status(403).json({ error: "only SUPER_MASTER can create masters" });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(409).json({ error: "username taken" });

  const passwordHash = await bcrypt.hash(password, 12);
  const child = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role,
      parentId: req.userId!,
      wallet: { create: { balance: 0 } },
    },
    select: { id: true, username: true, role: true, createdAt: true },
  });

  res.json(child);
});

// ----- Credit / debit chips -----
// Super-Master: mints from thin air (positive) or debits anyone (negative). No source deduction.
// Master: must transfer from their own wallet. Can credit anywhere in their downline.
const creditSchema = z.object({
  targetUserId: z.string(),
  amount: z.number(),
  note: z.string().max(200).optional(),
});

router.post("/credit", requireAuth, requireRole("SUPER_MASTER", "MASTER"), async (req: AuthedRequest, res) => {
  const parsed = creditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { targetUserId, amount, note } = parsed.data;

  if (amount === 0) return res.status(400).json({ error: "amount cannot be zero" });
  if (targetUserId === req.userId) return res.status(400).json({ error: "cannot credit yourself" });

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { wallet: true },
  });
  if (!target) return res.status(404).json({ error: "target user not found" });
  if (!target.wallet) return res.status(500).json({ error: "target wallet missing" });

  // MASTER may only act on their direct downline.
  if (req.role === "MASTER" && target.parentId !== req.userId) {
    return res.status(403).json({ error: "master can only credit their own downline" });
  }

  // For debit (amount < 0): ensure target has enough free balance.
  if (amount < 0 && target.wallet.balance + amount < 0) {
    return res.status(400).json({ error: "target has insufficient balance" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. For MASTER: deduct from / refund to their own wallet.
      if (req.role === "MASTER") {
        const actor = await tx.wallet.findUnique({ where: { userId: req.userId! } });
        if (!actor) throw new Error("actor wallet missing");
        // crediting target (amount > 0) → actor loses amount
        // debiting  target (amount < 0) → actor gains  |amount|
        const actorDelta = -amount;
        if (actor.balance + actorDelta < 0) throw new Error("insufficient balance in your wallet");
        await tx.wallet.update({
          where: { userId: req.userId! },
          data: { balance: { increment: actorDelta } },
        });
        await tx.transaction.create({
          data: {
            userId: req.userId!,
            amount: actorDelta,
            type: amount > 0 ? "TRANSFER_OUT" : "TRANSFER_IN",
            note: `${amount > 0 ? "to" : "from"} ${target.username}: ${note ?? ""}`,
            refId: targetUserId,
          },
        });
      }
      // 2. Apply to target wallet.
      await tx.wallet.update({
        where: { userId: targetUserId },
        data: { balance: { increment: amount } },
      });
      await tx.transaction.create({
        data: {
          userId: targetUserId,
          amount,
          type: req.role === "SUPER_MASTER"
            ? (amount > 0 ? "SUPER_CREDIT" : "SUPER_DEBIT")
            : (amount > 0 ? "TRANSFER_IN" : "TRANSFER_OUT"),
          note: `${amount > 0 ? "from" : "to"} ${req.role === "SUPER_MASTER" ? "super-master" : "master"}: ${note ?? ""}`,
          refId: req.userId,
        },
      });
    });

    const updatedTarget = await prisma.wallet.findUnique({ where: { userId: targetUserId } });
    res.json({ ok: true, targetBalance: updatedTarget?.balance });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ----- List downline -----
// scope=direct (default): only direct children
// scope=tree: SUPER_MASTER only — everyone in the system (excluding super-master self)
router.get("/downline", requireAuth, requireRole("SUPER_MASTER", "MASTER"), async (req: AuthedRequest, res) => {
  const scope = req.query.scope === "tree" ? "tree" : "direct";

  if (scope === "tree" && req.role !== "SUPER_MASTER") {
    return res.status(403).json({ error: "tree scope is super-master only" });
  }

  const where = scope === "tree"
    ? { role: { in: ["MASTER", "USER"] } }
    : { parentId: req.userId! };

  const children = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      role: true,
      parentId: true,
      parent: { select: { username: true, role: true } },
      createdAt: true,
      wallet: { select: { balance: true, exposure: true } },
      _count: { select: { children: true, bets: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
  });
  res.json(children);
});

// ----- Password reset requests (request-then-approve flow) -----
//
// Users request resets at POST /auth/request-reset (public). Admins see and
// resolve pending requests here. No direct admin-initiated reset exists by
// design — every reset must originate from a user request and carry an audit
// trail of who requested + who approved + what verification was done.

// List PENDING requests visible to this admin.
// MASTER → only requests from their direct downline.
// SUPER_MASTER → ?scope=tree returns the whole system; default = direct children only.
router.get("/reset-requests", requireAuth, requireRole("SUPER_MASTER", "MASTER"), async (req: AuthedRequest, res) => {
  const scope = req.query.scope === "tree" ? "tree" : "direct";
  if (scope === "tree" && req.role !== "SUPER_MASTER") {
    return res.status(403).json({ error: "tree scope is super-master only" });
  }

  const userWhere = scope === "tree"
    ? { role: { in: ["MASTER", "USER"] } }
    : { parentId: req.userId! };

  const requests = await prisma.passwordResetRequest.findMany({
    where: {
      status: "PENDING",
      user: userWhere,
    },
    include: {
      user: {
        select: {
          id: true, username: true, role: true,
          parent: { select: { username: true, role: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(requests);
});

// Approve a pending request: verify the request, set new password, log audit.
const approveSchema = z.object({
  newPassword: z.string().min(6, "new password must be at least 6 characters").max(72),
  verificationNote: z
    .string()
    .min(15, "verification note must be at least 15 characters — describe how you verified")
    .max(500),
  attestVerified: z.literal(true, {
    errorMap: () => ({ message: "you must attest that you verified the user's identity" }),
  }),
});

router.post("/reset-requests/:id/approve", requireAuth, requireRole("SUPER_MASTER", "MASTER"), async (req: AuthedRequest, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { newPassword, verificationNote } = parsed.data;

  const request = await prisma.passwordResetRequest.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, username: true, role: true, parentId: true } } },
  });
  if (!request) return res.status(404).json({ error: "request not found" });
  if (request.status !== "PENDING") return res.status(400).json({ error: `request is ${request.status}` });

  const target = request.user;
  if (req.role === "MASTER" && target.parentId !== req.userId) {
    return res.status(403).json({ error: "master can only approve requests for their downline" });
  }
  if (target.role === "SUPER_MASTER") {
    return res.status(403).json({ error: "cannot reset super-master via this endpoint" });
  }

  const actor = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { username: true, role: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });
    await tx.passwordResetRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        approvedById: req.userId!,
        approvalNote: verificationNote,
        resolvedAt: new Date(),
      },
    });
    // Audit: target's statement.
    await tx.transaction.create({
      data: {
        userId: target.id,
        amount: 0,
        type: "PASSWORD_RESET",
        note: `password reset by ${actor?.role} ${actor?.username} after request "${request.reason}" — verified: ${verificationNote}`,
        refId: req.userId,
      },
    });
    // Audit: admin's statement.
    await tx.transaction.create({
      data: {
        userId: req.userId!,
        amount: 0,
        type: "PASSWORD_RESET_ISSUED",
        note: `approved reset for ${target.role} ${target.username} (req: "${request.reason}") — verified: ${verificationNote}`,
        refId: target.id,
      },
    });
  });

  res.json({ ok: true, target: { id: target.id, username: target.username } });
});

// Reject a pending request (no password change).
const rejectSchema = z.object({
  reason: z.string().min(5, "rejection reason must be at least 5 characters").max(300),
});

router.post("/reset-requests/:id/reject", requireAuth, requireRole("SUPER_MASTER", "MASTER"), async (req: AuthedRequest, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const request = await prisma.passwordResetRequest.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, username: true, role: true, parentId: true } } },
  });
  if (!request) return res.status(404).json({ error: "request not found" });
  if (request.status !== "PENDING") return res.status(400).json({ error: `request is ${request.status}` });
  if (req.role === "MASTER" && request.user.parentId !== req.userId) {
    return res.status(403).json({ error: "master can only resolve requests for their downline" });
  }

  await prisma.passwordResetRequest.update({
    where: { id: request.id },
    data: {
      status: "REJECTED",
      approvedById: req.userId!,
      approvalNote: parsed.data.reason,
      resolvedAt: new Date(),
    },
  });

  res.json({ ok: true });
});

// ----- External-match subscriptions (India Today live matches) -----

router.get("/external-matches", requireAuth, requireRole("SUPER_MASTER"), async (_req, res) => {
  const ids = listSubscriptions();
  const matches = await prisma.match.findMany({
    where: { externalSource: "INDIA_TODAY", externalId: { in: ids } },
    select: { id: true, name: true, inPlay: true, externalId: true, externalSource: true },
  });
  res.json({ subscriptions: ids, matches });
});

const subAddSchema = z.object({
  externalId: z.string().regex(/^\d+$/, "externalId should be the numeric match id from India Today URL"),
});

router.post("/external-matches/add", requireAuth, requireRole("SUPER_MASTER"), async (req: AuthedRequest, res) => {
  const parsed = subAddSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { externalId } = parsed.data;
  addSubscription(externalId);
  // immediately try a sync so the user gets feedback
  const matchId = await syncMatch(externalId);
  if (!matchId) {
    return res.status(400).json({ error: "subscribed, but initial sync returned no data (check the match id is correct and live on indiatoday)" });
  }
  res.json({ ok: true, matchId });
});

router.post("/external-matches/remove", requireAuth, requireRole("SUPER_MASTER"), async (req: AuthedRequest, res) => {
  const parsed = subAddSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  removeSubscription(parsed.data.externalId);
  res.json({ ok: true });
});

// ----- Super-master only: regenerate the fixture slate -----
// Wipes all non-bet-related match data and creates a fresh batch.
// Existing bets are preserved (FK is deferred-only via cascade so we are
// careful here — only delete matches with no open bets).
router.post("/regenerate-fixtures", requireAuth, requireRole("SUPER_MASTER"), async (_req, res) => {
  // Identify matches that have NO bets attached to any of their markets.
  const safeMatches = await prisma.match.findMany({
    where: { markets: { every: { bets: { none: {} } } } },
    select: { id: true },
  });
  const ids = safeMatches.map(m => m.id);
  if (ids.length > 0) {
    await prisma.match.deleteMany({ where: { id: { in: ids } } });
  }
  const result = await generateSlate();
  res.json({ ok: true, deleted: ids.length, generated: result.generated });
});

// ----- Super-master only: force a market to settle with a chosen winner -----
// Used for ops scenarios (manual override) and for end-to-end pari-mutuel tests.
router.post("/markets/:id/settle", requireAuth, requireRole("SUPER_MASTER"), async (req: AuthedRequest, res) => {
  const marketId = req.params.id;
  const winnerRunnerId = String(req.body?.winnerRunnerId ?? "");
  if (!winnerRunnerId) return res.status(400).json({ error: "winnerRunnerId required" });

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { runners: { select: { id: true, name: true } } },
  });
  if (!market) return res.status(404).json({ error: "market not found" });
  if (market.status !== "OPEN") return res.status(400).json({ error: `market is ${market.status}` });
  const winner = market.runners.find(r => r.id === winnerRunnerId);
  if (!winner) return res.status(400).json({ error: "winnerRunnerId is not a runner of this market" });

  await settlementEngine.settleMarket(marketId, winnerRunnerId);
  res.json({ ok: true, marketName: market.name, winner: winner.name });
});

// ----- Super-master only: delete a single match -----
// Refunds any OPEN bets first (returns liability to balance, drops exposure)
// so wallet state stays consistent. Cascade then drops markets/runners/bets.
router.delete("/matches/:id", requireAuth, requireRole("SUPER_MASTER"), async (req: AuthedRequest, res) => {
  const matchId = req.params.id;
  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, name: true } });
  if (!match) return res.status(404).json({ error: "match not found" });

  const result = await prisma.$transaction(async (tx) => {
    const openBets = await tx.bet.findMany({
      where: { status: "OPEN", market: { matchId } },
      select: { userId: true, liability: true },
    });
    // Group refunds by user so we issue one wallet write per user.
    const refundByUser = new Map<string, number>();
    for (const b of openBets) {
      refundByUser.set(b.userId, (refundByUser.get(b.userId) ?? 0) + b.liability);
    }
    for (const [userId, amount] of refundByUser) {
      await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount }, exposure: { decrement: amount } },
      });
    }
    await tx.match.delete({ where: { id: matchId } });
    return { refundedBets: openBets.length, refundedUsers: refundByUser.size };
  });

  res.json({ ok: true, name: match.name, ...result });
});

// ----- Super-master only: delete every "mock" match (no externalSource) -----
// Use this when you want to clear the auto-generated slate so only real
// ingested/linked matches remain. Same safety filter as regenerate-fixtures:
// only matches with zero bets across all their markets are touched.
router.post("/cleanup-mock-matches", requireAuth, requireRole("SUPER_MASTER"), async (_req, res) => {
  const safeMatches = await prisma.match.findMany({
    where: {
      externalSource: null,
      markets: { every: { bets: { none: {} } } },
    },
    select: { id: true },
  });
  const ids = safeMatches.map(m => m.id);
  if (ids.length > 0) {
    await prisma.match.deleteMany({ where: { id: { in: ids } } });
  }
  const skipped = await prisma.match.count({ where: { externalSource: null } });
  res.json({ ok: true, deleted: ids.length, skippedDueToBets: skipped });
});

export default router;
