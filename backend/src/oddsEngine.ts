// Pari-mutuel odds engine.
//
// Rates are NOT random and don't drift on their own. Each tick (and whenever
// triggered by a bet placement, via recalcMarket), we recompute every runner's
// displayed rate from the pool state:
//
//   back_rate[R] = (back_stake[R] + lay_stake[R]) / back_stake[R]
//   lay_rate[R]  = (back_stake[R] + lay_stake[R]) / lay_stake[R]
//
// If a side has no bets, its rate is null and the UI shows "-".
// Sizes shown are the actual pool stakes (back/lay), so users see real money
// committed to each side.

import { EventEmitter } from "events";
import { prisma } from "./prisma";
import { loadRunnerPools } from "./poolPricing";

type RunnerUpdate = {
  id: string;
  backOdds: number | null;
  backSize: number | null;
  layOdds: number | null;
  laySize: number | null;
};

type MarketTick = {
  marketId: string;
  ts: number;
  runners: RunnerUpdate[];
};

const TICK_MS = 3000;

class OddsEngine extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (this.timer) return;
    console.log(`[odds-engine] starting, tick=${TICK_MS}ms (pari-mutuel)`);
    this.timer = setInterval(() => this.tick().catch(e => console.error("[odds-engine]", e)), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const markets = await prisma.market.findMany({
      where: { status: "OPEN", match: { inPlay: true } },
      include: { runners: true },
    });
    for (const m of markets) await this.recalcMarket(m.id);
  }

  // Called from the periodic tick AND from bets.ts after a placement, so the
  // rate update is visible to other clients immediately rather than waiting
  // up to TICK_MS for the next sweep.
  async recalcMarket(marketId: string) {
    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { runners: true },
    });
    if (!market) return;

    const pools = await loadRunnerPools(marketId);

    const updates: RunnerUpdate[] = [];
    for (const r of market.runners) {
      const p = pools.get(r.id);
      const backStake = p?.backStake ?? 0;
      const layStake  = p?.layStake  ?? 0;
      const poolSum   = backStake + layStake;
      const backRate  = backStake > 0 ? roundRate(poolSum / backStake) : null;
      const layRate   = layStake  > 0 ? roundRate(poolSum / layStake)  : null;
      // Only emit a change if anything's different (cheap dedup).
      if (
        r.backOdds !== backRate || r.layOdds !== layRate ||
        r.backSize !== backStake || r.laySize !== layStake
      ) {
        updates.push({
          id: r.id,
          backOdds: backRate,
          backSize: backStake > 0 ? Math.round(backStake) : null,
          layOdds: layRate,
          laySize: layStake > 0 ? Math.round(layStake) : null,
        });
      }
    }
    if (updates.length === 0) return;

    await prisma.$transaction(
      updates.map(u =>
        prisma.runner.update({
          where: { id: u.id },
          data: {
            backOdds: u.backOdds,
            backSize: u.backSize,
            layOdds: u.layOdds,
            laySize: u.laySize,
          },
        })
      )
    );

    const payload: MarketTick = { marketId, ts: Date.now(), runners: updates };
    this.emit("market-tick", payload);
    this.emit(`market-tick:${marketId}`, payload);
  }
}

// Match exchange precision conventions.
function roundRate(n: number): number {
  if (n < 2) return Math.round(n * 100) / 100;
  if (n < 3) return Math.round(n * 50) / 50;
  if (n < 4) return Math.round(n * 20) / 20;
  if (n < 10) return Math.round(n * 10) / 10;
  return Math.round(n);
}

export const oddsEngine = new OddsEngine();
export type { MarketTick, RunnerUpdate };
