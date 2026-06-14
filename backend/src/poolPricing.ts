// Pari-mutuel pricing — one shared pool per runner per market.
//
// For each runner R in a market:
//   back_stake[R]  = Σ stake of OPEN BACK bets on R
//   lay_stake[R]   = Σ stake of OPEN LAY  bets on R
//   pool[R]        = back_stake[R] + lay_stake[R]
//   back_rate[R]   = pool[R] / back_stake[R]   (paid to each BACK on R if R wins)
//   lay_rate[R]    = pool[R] / lay_stake[R]    (paid to each LAY  on R if R loses)
//
// Coin integrity (per runner):
//   money in   = back_stake[R] + lay_stake[R]                       = pool[R]
//   money out  = back_stake[R] * back_rate[R]   if R wins           = pool[R]
//              = lay_stake[R]  * lay_rate[R]    if R loses          = pool[R]
//   ∆         = 0   no coin created, no coin destroyed
//
// Edge cases (no opposing side):
//   if back_stake[R] = 0 and R wins  → LAY bets refunded (no opposing party)
//   if lay_stake[R]  = 0 and R loses → BACK bets refunded
//   Refund means stake returns to the bettor's balance — still integrity-safe.

import { prisma } from "./prisma";

export interface RunnerPool {
  runnerId: string;
  backStake: number;
  layStake: number;
  pool: number;
  backRate: number | null; // null = no BACK pool, no rate definable
  layRate: number | null;
}

// Live aggregate of OPEN bets per (runner, side) for one market.
export async function loadRunnerPools(marketId: string): Promise<Map<string, RunnerPool>> {
  const rows = await prisma.bet.groupBy({
    by: ["runnerId", "side"],
    where: { marketId, status: "OPEN" },
    _sum: { stake: true },
  });

  const acc = new Map<string, { backStake: number; layStake: number }>();
  for (const row of rows) {
    const e = acc.get(row.runnerId) ?? { backStake: 0, layStake: 0 };
    const s = row._sum.stake ?? 0;
    if (row.side === "BACK") e.backStake = s;
    else if (row.side === "LAY") e.layStake = s;
    acc.set(row.runnerId, e);
  }

  const out = new Map<string, RunnerPool>();
  for (const [runnerId, e] of acc) {
    out.set(runnerId, summarise(runnerId, e.backStake, e.layStake));
  }
  return out;
}

export function summarise(runnerId: string, backStake: number, layStake: number): RunnerPool {
  const pool = backStake + layStake;
  return {
    runnerId,
    backStake,
    layStake,
    pool,
    backRate: backStake > 0 ? pool / backStake : null,
    layRate:  layStake  > 0 ? pool / layStake  : null,
  };
}

// What rate a bettor sees post-trade — i.e. the rate that includes their own
// stake in the winning side. This is what they'd be paid if their side wins
// AND no further bets arrive. Real payout is recomputed at settlement against
// the final pool.
export function ratePostTrade(
  side: "BACK" | "LAY",
  stake: number,
  backStake: number,
  layStake: number,
): number {
  const newBack = side === "BACK" ? backStake + stake : backStake;
  const newLay  = side === "LAY"  ? layStake  + stake : layStake;
  const pool = newBack + newLay;
  const own = side === "BACK" ? newBack : newLay;
  // own is always > 0 here because we just added our own stake to it.
  return pool / own;
}
