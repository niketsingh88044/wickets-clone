// India Today live-score ingester.
//
// Fetches the publicly-readable JSON endpoint that powers their scorecard
// pages and maps it into our Match/Market/Runner schema. Used to give the
// demo at least 1-2 *real* live matches alongside the simulated slate.
//
// Caveats:
//   - This is their internal API. They could rename/auth-gate it at any time
//     and our code would silently start returning nothing. Defensive coding.
//   - No odds in the feed (it's a scorecard, not a betting market) — we still
//     seed Match Odds / Bookmaker with simulated prices, then let the odds
//     engine drift them. The real-data layer just controls match metadata
//     (teams, in-play status) and ball outcomes for FANCY settlement.

import { prisma } from "./prisma";
import { settlementEngine } from "./settlementEngine";

const SOURCE = "INDIA_TODAY";
const SCORECARD_URL = (id: string) =>
  `https://www.indiatoday.in/live-score/cricket/full_scorecardApiData/${id}`;

interface ScorecardJson {
  scorecard?: {
    match_Id?: string;
    teama?: string;
    teamb?: string;
    teama_short?: string;
    teamb_short?: string;
    tourname_en?: string;
    matchStatusKey?: string;          // "Live" | "Upcoming" | "Finished" | …
    matchstatus?: string;
    is_live?: string;                  // "1" | "0"
    upcoming?: string;
    matchdate_ist?: string;            // "6/5/2026"
    match_type?: string;               // "T20" | "ODI" | "Test"
    current_inn?: string;
    matchresult?: string;
  };
}

// Per-match "no data" tracking so we don't spam the log on every poll for a
// match that's ended (their endpoint silently returns empty body once a match
// is no longer live).
const noDataSince = new Map<string, number>();
const QUIET_LOG_WINDOW_MS = 5 * 60_000;

async function fetchScorecard(matchId: string): Promise<ScorecardJson | null> {
  try {
    const res = await fetch(SCORECARD_URL(matchId), {
      headers: { "User-Agent": "Mozilla/5.0 (wickets-clone-demo)" },
    });
    if (!res.ok) {
      logQuiet(matchId, `HTTP ${res.status}`);
      return null;
    }
    const body = await res.text();
    if (!body || body.length < 2) {
      logQuiet(matchId, "empty body — match probably ended or not live");
      return null;
    }
    try {
      const j = JSON.parse(body) as ScorecardJson;
      noDataSince.delete(matchId);
      return j;
    } catch {
      logQuiet(matchId, "non-JSON body");
      return null;
    }
  } catch (e) {
    logQuiet(matchId, (e as Error).message);
    return null;
  }
}

function logQuiet(matchId: string, msg: string) {
  const first = noDataSince.get(matchId);
  if (!first || Date.now() - first > QUIET_LOG_WINDOW_MS) {
    console.warn(`[indiatoday] ${matchId}: ${msg}`);
    noDataSince.set(matchId, Date.now());
  }
}

function buildMatchName(sc: NonNullable<ScorecardJson["scorecard"]>): string {
  const tour = sc.tourname_en ? ` — ${sc.tourname_en}` : "";
  const fmt = sc.match_type ? ` (${sc.match_type})` : "";
  return `${sc.teama} v ${sc.teamb}${fmt}${tour}`;
}

function parseStartTime(sc: NonNullable<ScorecardJson["scorecard"]>): Date {
  // matchdate_ist comes as "M/D/YYYY"; no time component reliably available.
  if (sc.matchdate_ist) {
    const [m, d, y] = sc.matchdate_ist.split("/").map(Number);
    if (m && d && y) return new Date(y, m - 1, d, 9, 0, 0); // assume 9am IST default
  }
  return new Date();
}

/**
 * Upsert a single India Today match.
 * - Creates Match + Match-Odds, Bookmaker, Ball-By-Ball markets on first sync.
 * - Updates inPlay / name on subsequent syncs.
 * - Returns the resulting Match.id, or null if the source returned nothing usable.
 */
export async function syncMatch(externalMatchId: string): Promise<string | null> {
  const json = await fetchScorecard(externalMatchId);
  const sc = json?.scorecard;
  if (!sc || !sc.teama || !sc.teamb) {
    console.warn(`[indiatoday] ${externalMatchId} no scorecard payload`);
    return null;
  }

  const isLive = sc.is_live === "1" || sc.matchStatusKey === "Live";
  const isFinished = sc.matchStatusKey === "Finished" || (sc.matchresult ?? "").length > 0;

  const existing = await prisma.match.findUnique({
    where: { externalSource_externalId: { externalSource: SOURCE, externalId: externalMatchId } },
  });

  if (existing) {
    await prisma.match.update({
      where: { id: existing.id },
      data: {
        name: buildMatchName(sc),
        inPlay: isLive && !isFinished,
      },
    });
    return existing.id;
  }

  // First sync — create with seeded markets.
  // We don't get real odds from this feed, so we seed plausible openers
  // (50/50 with small overround) and let the odds engine drift them.
  const created = await prisma.match.create({
    data: {
      sport: "CRICKET",
      name: buildMatchName(sc),
      startTime: parseStartTime(sc),
      inPlay: isLive && !isFinished,
      externalId: externalMatchId,
      externalSource: SOURCE,
      markets: {
        create: [
          {
            name: "Match Odds",
            type: "MATCH_ODDS",
            runners: {
              create: [
                { name: sc.teama, sortOrder: 0, backOdds: 2.0, backSize: 60000, layOdds: 2.04, laySize: 60000 },
                { name: sc.teamb, sortOrder: 1, backOdds: 1.95, backSize: 60000, layOdds: 1.99, laySize: 60000 },
              ],
            },
          },
          {
            name: "Bookmaker",
            type: "BOOKMAKER",
            maxStake: 50000,
            runners: {
              create: [
                { name: sc.teama, sortOrder: 0, backOdds: 50, backSize: 50000, layOdds: 52, laySize: 50000 },
                { name: sc.teamb, sortOrder: 1, backOdds: 50, backSize: 50000, layOdds: 52, laySize: 50000 },
              ],
            },
          },
          ...(isLive ? [{
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
          }] : []),
        ],
      },
    },
  });

  console.log(`[indiatoday] ingested new match: ${created.name} (id=${created.id})`);

  // If the match is finished by the time we first see it, settle markets.
  if (isFinished) {
    await settlementEngine.forceSettleMatchMarkets(created.id);
    await prisma.match.update({ where: { id: created.id }, data: { inPlay: false } });
  }

  return created.id;
}

// ----- Subscription list (in-memory + file-persistent later) -----
//
// For now: in-process Set. The seed list below makes 271343 (Oman v Hong Kong)
// always available. Admin can add more via /admin/external-matches.

// Start empty. The user adds live match IDs via /admin/external-matches/add
// (or the admin UI) when they spot a currently-running match on indiatoday.
// The 271343 example we tested with has finished and is no longer queryable.
const subscribed = new Set<string>([]);

export function addSubscription(externalId: string) {
  subscribed.add(externalId);
}
export function removeSubscription(externalId: string) {
  subscribed.delete(externalId);
}
export function listSubscriptions(): string[] {
  return [...subscribed];
}

let pollTimer: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 30_000;

export function startIngester() {
  if (pollTimer) return;
  console.log(`[indiatoday] starting poller (${POLL_INTERVAL_MS}ms) for ${subscribed.size} subscription(s)`);
  const tick = async () => {
    for (const id of subscribed) {
      await syncMatch(id);
    }
  };
  tick().catch(e => console.error("[indiatoday] initial sync:", e));
  pollTimer = setInterval(() => tick().catch(e => console.error("[indiatoday] poll:", e)), POLL_INTERVAL_MS);
}

export function stopIngester() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
