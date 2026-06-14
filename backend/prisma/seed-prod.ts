// Idempotent production seed — runs on every Render build.
//
// Only creates the SUPER_MASTER account if it doesn't already exist; never
// touches existing data. (The other seed.ts in this folder is destructive
// and is intended for local dev DB resets only — do NOT run it on prod.)
//
// Credentials default to nike / nike1234 to match local dev. Override at
// deploy time by setting SUPER_MASTER_USERNAME / SUPER_MASTER_PASSWORD
// in the Render environment if you want different ones.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SUPER_MASTER_USERNAME ?? "nike";
  const password = process.env.SUPER_MASTER_PASSWORD ?? "nike1234";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`[seed-prod] super-master "${username}" already exists, skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const created = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: "SUPER_MASTER",
      wallet: { create: { balance: 0 } },
    },
  });
  console.log(`[seed-prod] created super-master ${created.username} (id=${created.id})`);
}

main()
  .catch(e => { console.error("[seed-prod] failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
