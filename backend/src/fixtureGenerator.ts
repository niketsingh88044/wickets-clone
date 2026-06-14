// Generates a realistic slate of cricket matches with plausible opening odds.
// Runs on backend boot when the match slate is depleted, and on demand via
// /admin/regenerate-fixtures. Existing user bets are not touched — we only
// add new matches; the periodic "promote" job ages them through
// tomorrow → today → in-play → finished.

import { prisma } from "./prisma";
import { settlementEngine } from "./settlementEngine";

// ---- Team & competition pools ----

const INTERNATIONAL_TEAMS = [
  "England", "India", "Australia", "Pakistan", "New Zealand", "South Africa",
  "Sri Lanka", "Bangladesh", "Afghanistan", "West Indies", "Zimbabwe", "Ireland",
  "Netherlands", "Scotland",
] as const;

const IPL_TEAMS = [
  "Mumbai Indians", "Chennai Super Kings", "Royal Challengers Bengaluru",
  "Kolkata Knight Riders", "Delhi Capitals", "Sunrisers Hyderabad",
  "Rajasthan Royals", "Punjab Kings", "Lucknow Super Giants", "Gujarat Titans",
] as const;

const BBL_TEAMS = [
  "Sydney Sixers", "Melbourne Stars", "Perth Scorchers", "Brisbane Heat",
  "Adelaide Strikers", "Hobart Hurricanes", "Sydney Thunder", "Melbourne Renegades",
] as const;

const COUNTY_TEAMS = [
  "Surrey", "Lancashire", "Yorkshire", "Somerset", "Hampshire", "Nottinghamshire",
  "Glamorgan", "Sussex", "Essex", "Durham", "Middlesex", "Warwickshire",
  "Gloucestershire", "Worcestershire", "Leicestershire", "Kent", "Derbyshire",
  "Northamptonshire",
] as const;

const WOMENS_INT_TEAMS = [
  "India W", "England W", "Australia W", "New Zealand W", "South Africa W",
  "Pakistan W", "Sri Lanka W", "Bangladesh W", "Ireland W", "Netherlands W",
] as const;

type SlateTier = {
  pool: readonly string[];
  format: string;
  weight: number;  // relative likelihood of being picked
  durationHrs: number;
  baseFavOdds: [number, number]; // [min, max] favourite back odds
};

const TIERS: SlateTier[] = [
  { pool: INTERNATIONAL_TEAMS, format: "T20I",     weight: 4, durationHrs: 3.5, baseFavOdds: [1.4, 2.2] },
  { pool: INTERNATIONAL_TEAMS, format: "ODI",      weight: 2, durationHrs: 7,   baseFavOdds: [1.3, 2.5] },
  { pool: INTERNATIONAL_TEAMS, format: "Test",     weight: 1, durationHrs: 30,  baseFavOdds: [1.5, 2.8] },
  { pool: IPL_TEAMS,           format: "IPL",      weight: 5, durationHrs: 3.5, baseFavOdds: [1.5, 2.4] },
  { pool: BBL_TEAMS,           format: "BBL",      weight: 3, durationHrs: 3.5, baseFavOdds: [1.5, 2.3] },
  { pool: COUNTY_TEAMS,        format: "T20 Blast", weight: 3, durationHrs: 3.5, baseFavOdds: [1.6, 2.5] },
  { pool: WOMENS_INT_TEAMS,    format: "Women's T20I", weight: 2, durationHrs: 3.5, baseFavOdds: [1.3, 2.8] },
];

// ---- RNG helpers ----

function pickWeighted<T extends { weight: number }>(arr: T[]): T {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of arr) { r -= x.weight; if (r <= 0) return x; }
  return arr[arr.length - 1];
}

function pickTwo<T>(pool: readonly T[]): [T, T] {
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = a;
  while (b === a) b = pool[Math.floor(Math.random() * pool.length)];
  return [a, b];
}

function round2(n: number): number {
  if (n < 2) return Math.round(n * 100) / 100;
  if (n < 3) return Math.round(n * 50) / 50;
  if (n < 4) return Math.round(n * 20) / 20;
  if (n < 10) return Math.round(n * 10) / 10;
  return Math.round(n);
}

// ---- Match builder ----

function buildMatchData(opts: { offsetMinutes: number; inPlay: boolean }) {
  const tier = pickWeighted(TIERS);
  const [a, b] = pickTwo(tier.pool);
  const name = `${a} v ${b}`;
  const startTime = new Date(Date.now() + opts.offsetMinutes * 60_000);

  // Coin-flip on which side is the favourite.
  const aIsFav = Math.random() > 0.5;
  const [favLo, favHi] = tier.baseFavOdds;
  const favBack = round2(favLo + Math.random() * (favHi - favLo));
  // Implied probability of favourite
  const favProb = 1 / favBack;
  // Decent overround ~5%
  const dogProb = (1 - favProb) * 0.95;
  const dogBack = round2(Math.max(1.05, 1 / dogProb));
  const drawProb = 1 - favProb - dogProb;
  const drawBack = tier.format === "Test" && drawProb > 0.05
    ? round2(Math.max(2.5, 1 / drawProb))
    : null;

  const [team1Back, team2Back] = aIsFav ? [favBack, dogBack] : [dogBack, favBack];
  const team1Lay = round2(team1Back * (1 + 0.01 + Math.random() * 0.02));
  const team2Lay = round2(team2Back * (1 + 0.01 + Math.random() * 0.02));
  const drawLay = drawBack ? round2(drawBack * (1 + 0.02 + Math.random() * 0.03)) : null;

  const matchOddsRunners: any[] = [
    { name: a, sortOrder: 0, backOdds: team1Back, backSize: 50000 + Math.round(Math.random() * 100000), layOdds: team1Lay, laySize: 50000 + Math.round(Math.random() * 100000) },
  ];
  if (drawBack) {
    matchOddsRunners.push({ name: "Draw", sortOrder: 1, backOdds: drawBack, backSize: 5000 + Math.round(Math.random() * 15000), layOdds: drawLay, laySize: 5000 + Math.round(Math.random() * 15000) });
    matchOddsRunners.push({ name: b, sortOrder: 2, backOdds: team2Back, backSize: 50000 + Math.round(Math.random() * 100000), layOdds: team2Lay, laySize: 50000 + Math.round(Math.random() * 100000) });
  } else {
    matchOddsRunners.push({ name: b, sortOrder: 1, backOdds: team2Back, backSize: 50000 + Math.round(Math.random() * 100000), layOdds: team2Lay, laySize: 50000 + Math.round(Math.random() * 100000) });
  }

  // Bookmaker market (parallel pricing in % units, common on Indian exchanges).
  const bookmakerRunners = matchOddsRunners
    .filter(r => r.name !== "Draw")
    .map((r, i) => {
      const pct = Math.round(95 / r.backOdds);
      return {
        name: r.name,
        sortOrder: i,
        backOdds: pct,
        backSize: 40000 + Math.round(Math.random() * 60000),
        layOdds: pct + 2,
        laySize: 40000 + Math.round(Math.random() * 60000),
      };
    });

  const markets: any[] = [
    {
      name: "Match Odds",
      type: "MATCH_ODDS",
      minStake: 100,
      maxStake: 100000,
      runners: { create: matchOddsRunners },
    },
    {
      name: "Bookmaker",
      type: "BOOKMAKER",
      minStake: 100,
      maxStake: 50000,
      runners: { create: bookmakerRunners },
    },
  ];

  // Ball-By-Ball fancy only for in-play (active deliveries).
  if (opts.inPlay) {
    markets.push({
      name: "Ball By Ball",
      type: "FANCY",
      minStake: 100,
      maxStake: 100000,
      runners: {
        create: [
          { name: "0 RUNS",      sortOrder: 0, backOdds: 2.18, backSize: 99700 },
          { name: "1 RUNS",      sortOrder: 1, backOdds: 2.62, backSize: 90716 },
          { name: "2 RUNS",      sortOrder: 2, backOdds: 7.92, backSize: 99000 },
          { name: "3 RUNS",      sortOrder: 3, backOdds: 11,   backSize: 100000 },
          { name: "4 RUNS",      sortOrder: 4, backOdds: 6.52, backSize: 98400 },
          { name: "6 RUNS",      sortOrder: 5, backOdds: 12.2, backSize: 99500 },
          { name: "WICKET",      sortOrder: 6, backOdds: 6.87, backSize: 100000 },
          { name: "EXTRA RUNS",  sortOrder: 7, backOdds: 8.67, backSize: 100000 },
        ],
      },
    });
  }

  return {
    sport: "CRICKET",
    name: `${name} (${tier.format})`,
    startTime,
    inPlay: opts.inPlay,
    markets: { create: markets },
  };
}

// ---- Public API ----

export async function generateSlate(opts: { inPlay?: number; today?: number; tomorrow?: number } = {}) {
  const inPlayCount = opts.inPlay ?? 6;
  const todayCount = opts.today ?? 5;
  const tomorrowCount = opts.tomorrow ?? 5;

  const tasks: Promise<unknown>[] = [];

  // In-play: started 5min – 90min ago
  for (let i = 0; i < inPlayCount; i++) {
    const offset = -(5 + Math.floor(Math.random() * 85));
    tasks.push(prisma.match.create({ data: buildMatchData({ offsetMinutes: offset, inPlay: true }) }));
  }
  // Today: starts in the next 1-12 hours
  for (let i = 0; i < todayCount; i++) {
    const offset = 60 + Math.floor(Math.random() * 660);
    tasks.push(prisma.match.create({ data: buildMatchData({ offsetMinutes: offset, inPlay: false }) }));
  }
  // Tomorrow: 24-48h ahead
  for (let i = 0; i < tomorrowCount; i++) {
    const offset = 24 * 60 + Math.floor(Math.random() * 24 * 60);
    tasks.push(prisma.match.create({ data: buildMatchData({ offsetMinutes: offset, inPlay: false }) }));
  }

  await Promise.all(tasks);
  return { generated: tasks.length };
}

/**
 * Ensure we have a healthy slate of in-play / today / tomorrow matches.
 * Doesn't delete anything — just tops up if the in-play list is thin.
 * Safe to call on every backend boot.
 */
export async function ensureSlate() {
  const inPlay = await prisma.match.count({ where: { inPlay: true } });
  if (inPlay < 3) {
    console.log(`[fixtures] in-play count is ${inPlay}; generating fresh slate`);
    return generateSlate();
  }
  return { generated: 0 };
}

/**
 * Promote matches between buckets based on their startTime:
 *   - tomorrow → today (no action, just a time check)
 *   - scheduled → in-play (startTime ≤ now and not too old)
 *   - in-play → finished (more than 4h since start: settle them)
 * Run this on an interval.
 */
export async function promoteMatches() {
  const now = Date.now();

  // Promote scheduled matches whose start time has passed into in-play.
  const toStart = await prisma.match.findMany({
    where: {
      inPlay: false,
      startTime: { lte: new Date(now) },
    },
    select: { id: true, name: true },
  });
  for (const m of toStart) {
    await prisma.match.update({
      where: { id: m.id },
      data: {
        inPlay: true,
        markets: {
          create: {
            name: "Ball By Ball",
            type: "FANCY",
            runners: {
              create: [
                { name: "0 RUNS",     sortOrder: 0, backOdds: 2.18, backSize: 99700 },
                { name: "1 RUNS",     sortOrder: 1, backOdds: 2.62, backSize: 90716 },
                { name: "2 RUNS",     sortOrder: 2, backOdds: 7.92, backSize: 99000 },
                { name: "3 RUNS",     sortOrder: 3, backOdds: 11,   backSize: 100000 },
                { name: "4 RUNS",     sortOrder: 4, backOdds: 6.52, backSize: 98400 },
                { name: "6 RUNS",     sortOrder: 5, backOdds: 12.2, backSize: 99500 },
                { name: "WICKET",     sortOrder: 6, backOdds: 6.87, backSize: 100000 },
                { name: "EXTRA RUNS", sortOrder: 7, backOdds: 8.67, backSize: 100000 },
              ],
            },
          },
        },
      },
    });
    console.log(`[fixtures] promoted "${m.name}" to in-play`);
  }

  // Finish very-old in-play matches: settle their open markets (random winner)
  // so user bets resolve, then flip inPlay false.
  const stale = await prisma.match.findMany({
    where: {
      inPlay: true,
      startTime: { lt: new Date(now - 4 * 60 * 60 * 1000) },
    },
    select: { id: true, name: true },
  });
  for (const m of stale) {
    await settlementEngine.forceSettleMatchMarkets(m.id);
    await prisma.match.update({
      where: { id: m.id },
      data: { inPlay: false },
    });
    console.log(`[fixtures] retired "${m.name}" — all markets force-settled`);
  }

  // After retirement, top up if needed.
  await ensureSlate();
}
