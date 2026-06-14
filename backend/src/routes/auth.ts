import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

const router = Router();

const credSchema = z.object({
  username: z
    .string()
    .min(3, "username must be at least 3 characters")
    .max(64, "username too long")
    .regex(/^[a-zA-Z0-9._@+-]+$/, "username may contain letters, numbers, and . _ @ + -"),
  password: z
    .string()
    .min(6, "password must be at least 6 characters")
    .max(72, "password too long"),
});

router.post("/login", async (req, res) => {
  const parsed = credSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      wallet: true,
      parent: { select: { id: true, username: true, role: true } },
    },
  });
  if (!user) return res.status(401).json({ error: "invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      balance: user.wallet?.balance ?? 0,
      parent: user.parent ?? null,
    },
  });
});

// Self-service password change: any logged-in user (USER, MASTER, SUPER_MASTER)
// can change their own password by proving they know the current one.
const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "current password is required"),
  newPassword: z
    .string()
    .min(6, "new password must be at least 6 characters")
    .max(72, "new password too long"),
});

router.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { oldPassword, newPassword } = parsed.data;

  if (oldPassword === newPassword) {
    return res.status(400).json({ error: "new password must be different from current" });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "user not found" });

  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "current password is incorrect" });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });
    await tx.transaction.create({
      data: {
        userId: user.id,
        amount: 0,
        type: "SELF_PASSWORD_CHANGE",
        note: "password changed via self-service (old password verified)",
      },
    });
  });

  res.json({ ok: true });
});

// Public: anyone can request a password reset for a username.
// Never reveals whether the username exists (anti-enumeration).
// If it does exist, a PENDING PasswordResetRequest is created for an admin
// to verify out-of-band and approve.
const requestResetSchema = z.object({
  username: z.string().min(3).max(64),
  reason: z.string().min(5, "tell your admin what you need (min 5 chars)").max(300),
});

router.post("/request-reset", async (req, res) => {
  const parsed = requestResetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { username, reason } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (user && user.role !== "SUPER_MASTER") {
    // De-duplicate: if there's already a PENDING request for this user, return that.
    const existing = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: "PENDING" },
    });
    if (!existing) {
      await prisma.passwordResetRequest.create({
        data: { userId: user.id, reason, status: "PENDING" },
      });
    }
  }
  // Always say the same thing — don't leak which usernames exist.
  res.json({
    ok: true,
    message:
      "If the account exists, a reset request was filed. Contact your master / admin via WhatsApp or phone to have them approve it.",
  });
});

export default router;
