// End-to-end coin-integrity test for the pari-mutuel engine.
//
// Replays the user's example:
//   user1 LAY 100 on R, user2 LAY 200 on R, user3 BACK 400 on R, user4 BACK 50
//   total back = 450, total lay = 300, pool = 750
//   back_rate = 750/450 = 1.666…, lay_rate = 750/300 = 2.5
// Settles R=winner and verifies:
//   - each user's wallet ends exactly where it should
//   - sum of stakes in == sum of payouts out (no coin created/destroyed)

import { prisma } from "../src/prisma";
import { settlementEngine } from "../src/settlementEngine";
import { loadRunnerPools } from "../src/poolPricing";

const PLAYERS = [
  { name: "alice", side: "LAY"  as const, stake: 100 },
  { name: "bob",   side: "LAY"  as const, stake: 200 },
  { name: "carol", side: "BACK" as const, stake: 400 },
  { name: "dave",  side: "BACK" as const, stake: 50 },
];

const START_BAL = 1000;

async function main() {
  // 1. Create a synthetic non-cricbuzz match so no integrity rule fires.
  const match = await prisma.match.create({
    data: {
      sport: "CRICKET",
      name: `[TEST] PariMutuel Match ${Date.now()}`,
      startTime: new Date(),
      inPlay: true,
      markets: {
        create: [{
          name: "Match Odds",
          type: "MATCH_ODDS",
          runners: {
            create: [
              { name: "Runner R", sortOrder: 0 },
              { name: "Runner Q", sortOrder: 1 },
            ],
          },
        }],
      },
    },
    include: { markets: { include: { runners: true } } },
  });
  const marketId = match.markets[0].id;
  const runnerR = match.markets[0].runners[0];
  const runnerQ = match.markets[0].runners[1];
  console.log(`Created match ${match.id} with runner R=${runnerR.id} Q=${runnerQ.id}\n`);

  // 2. Make sure each player exists with a fresh START_BAL balance.
  for (const p of PLAYERS) {
    const existing = await prisma.user.findUnique({ where: { username: p.name } });
    if (!existing) {
      await prisma.user.create({
        data: {
          username: p.name,
          passwordHash: "x", // not used in this script
          role: "USER",
          wallet: { create: { balance: START_BAL, exposure: 0 } },
        },
      });
    } else {
      await prisma.wallet.update({
        where: { userId: existing.id },
        data: { balance: START_BAL, exposure: 0 },
      });
    }
  }

  // 3. Place each bet directly (simulate the /bets route inline).
  for (const p of PLAYERS) {
    const user = await prisma.user.findUnique({ where: { username: p.name } });
    if (!user) throw new Error("user missing");
    await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: user.id },
        data: { balance: { decrement: p.stake }, exposure: { increment: p.stake } },
      });
      await tx.bet.create({
        data: {
          userId: user.id,
          marketId,
          runnerId: runnerR.id,
          side: p.side,
          odds: 0,                 // rate snapshot — not used for settlement
          stake: p.stake,
          liability: p.stake,
          potentialPayout: 0,
        },
      });
    });
  }

  // 4. Inspect the resulting pool.
  const pools = await loadRunnerPools(marketId);
  const pool = pools.get(runnerR.id)!;
  console.log("Pool state on Runner R:");
  console.log(`  back_stake = ${pool.backStake}    (expected 450)`);
  console.log(`  lay_stake  = ${pool.layStake}     (expected 300)`);
  console.log(`  pool       = ${pool.pool}         (expected 750)`);
  console.log(`  back_rate  = ${pool.backRate?.toFixed(4)}   (expected 1.6667)`);
  console.log(`  lay_rate   = ${pool.layRate?.toFixed(4)}    (expected 2.5000)\n`);

  // 5. Pre-settlement wallets.
  console.log("Pre-settlement wallets:");
  const preTotal = await dumpWallets();

  // 6. Force-settle with R as winner.
  console.log("\nSettling market with Runner R as winner...");
  await settlementEngine.settleMarket(marketId, runnerR.id);

  // 7. Post-settlement wallets + verification.
  console.log("\nPost-settlement wallets:");
  const postTotal = await dumpWallets();

  console.log("\n=== INTEGRITY CHECK ===");
  console.log(`Total of all 4 wallets pre-bet placement was: 4 * ${START_BAL} = ${4 * START_BAL}`);
  console.log(`Total of all 4 wallets post-settlement:       ${postTotal}`);
  console.log(`∆ = ${postTotal - 4 * START_BAL}  (must be 0 for coin integrity)`);

  // 8. Per-user payout expectations
  console.log("\n=== PER-USER ===");
  for (const p of PLAYERS) {
    const u = await prisma.user.findUnique({ where: { username: p.name }, include: { wallet: true } });
    const expected =
      (p.side === "BACK")
        ? START_BAL - p.stake + (p.stake / 450) * 750  // BACK wins: stake * pool/back_stake
        : START_BAL - p.stake;                          // LAY loses
    console.log(`  ${p.name} (${p.side} ${p.stake}): balance=${u!.wallet!.balance.toFixed(2)}  expected=${expected.toFixed(2)}  ∆=${(u!.wallet!.balance - expected).toFixed(4)}`);
  }

  // 9. Cleanup: remove the test match and reset user wallets.
  await prisma.match.delete({ where: { id: match.id } });
  for (const p of PLAYERS) {
    const u = await prisma.user.findUnique({ where: { username: p.name } });
    if (u) await prisma.wallet.update({ where: { userId: u.id }, data: { balance: 0, exposure: 0 } });
  }
}

async function dumpWallets(): Promise<number> {
  let total = 0;
  for (const p of PLAYERS) {
    const u = await prisma.user.findUnique({ where: { username: p.name }, include: { wallet: true } });
    const bal = u!.wallet!.balance;
    const exp = u!.wallet!.exposure;
    total += bal + exp; // wallet "value" = balance + exposure (exposure is locked, not lost)
    console.log(`  ${p.name}: balance=${bal.toFixed(2)} exposure=${exp.toFixed(2)}`);
  }
  return total;
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
