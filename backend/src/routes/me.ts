import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

const router = Router();

router.get("/balance", requireAuth, async (req: AuthedRequest, res) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "wallet not found" });
  res.json({ balance: wallet.balance, exposure: wallet.exposure });
});

router.get("/profile", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: {
      id: true,
      username: true,
      role: true,
      createdAt: true,
      parentId: true,
      parent: { select: { id: true, username: true, role: true } },
    },
  });
  res.json(user);
});

// ----- Withdraw chips to parent (USER → MASTER, MASTER → SUPER_MASTER) -----
// The inverse of /admin/credit: a child returns chips up the hierarchy.
const withdrawSchema = z.object({
  amount: z.number().positive("amount must be positive"),
  note: z.string().max(200).optional(),
});

router.post("/withdraw", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { amount, note } = parsed.data;

  const me = await prisma.user.findUnique({
    where: { id: req.userId! },
    include: { wallet: true, parent: { include: { wallet: true } } },
  });
  if (!me) return res.status(404).json({ error: "user not found" });
  if (!me.parent || !me.parent.wallet) {
    return res.status(400).json({ error: "you have no parent account to withdraw to" });
  }
  if (!me.wallet) return res.status(500).json({ error: "wallet missing" });
  if (me.wallet.balance < amount) {
    return res.status(400).json({ error: `insufficient free balance (you have ${me.wallet.balance})` });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Decrement my wallet
      await tx.wallet.update({
        where: { userId: me.id },
        data: { balance: { decrement: amount } },
      });
      // Increment parent wallet
      await tx.wallet.update({
        where: { userId: me.parent!.id },
        data: { balance: { increment: amount } },
      });
      // Paired ledger entries
      await tx.transaction.create({
        data: {
          userId: me.id,
          amount: -amount,
          type: "WITHDRAW_TO_PARENT",
          note: `to ${me.parent!.role} ${me.parent!.username}${note ? ": " + note : ""}`,
          refId: me.parent!.id,
        },
      });
      await tx.transaction.create({
        data: {
          userId: me.parent!.id,
          amount,
          type: "WITHDRAW_FROM_CHILD",
          note: `from ${me.role} ${me.username}${note ? ": " + note : ""}`,
          refId: me.id,
        },
      });
    });

    const after = await prisma.wallet.findUnique({ where: { userId: me.id } });
    res.json({
      ok: true,
      newBalance: after!.balance,
      exposure: after!.exposure,
      sentTo: { username: me.parent.username, role: me.parent.role },
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/statement", requireAuth, async (req: AuthedRequest, res) => {
  const txns = await prisma.transaction.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(txns);
});

export default router;
