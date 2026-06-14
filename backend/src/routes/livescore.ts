// Proxy for the RapidAPI providers we use:
//   * free-livescore-api.p.rapidapi.com — cross-sport search (Teams/Stages)
//   * cricbuzz-cricket.p.rapidapi.com   — live cricket scoreboards
//
// All routes here are gated to MASTER / SUPER_MASTER so the free-tier quota
// can only be burned by an admin pressing a button — not by every page load
// of every regular user. Once admin refreshes a match's scorecard, the JSON
// is cached on the Match row in the DB; downstream users just read that.

import { Router } from "express";
import { prisma } from "../prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth";
import { settlementEngine } from "../settlementEngine";

const router = Router();

const SEARCH_HOST = "free-livescore-api.p.rapidapi.com";
const CRIC_HOST = "cricbuzz-cricket.p.rapidapi.com";
const CACHE_TTL_MS = 60_000;

// Tiny in-memory cache so back-to-back identical calls don't hit RapidAPI twice.
type CacheEntry = { ts: number; status: number; body: unknown };
const cache = new Map<string, CacheEntry>();

const adminOnly = [requireAuth, requireRole("SUPER_MASTER", "MASTER")];

async function rapidGet(apiHost: string, path: string): Promise<{ status: number; body: any }> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY not configured on server");

  const cacheKey = `${apiHost}|${path}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { status: cached.status, body: cached.body };
  }

  const r = await fetch(`https://${apiHost}/${path}`, {
    headers: {
      "x-rapidapi-host": apiHost,
      "x-rapidapi-key": key,
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  cache.set(cacheKey, { ts: Date.now(), status: r.status, body });
  return { status: r.status, body };
}

// ---------- Search (cross-sport teams/stages/categories) ----------
router.get("/search", ...adminOnly, async (req, res) => {
  const sport = String(req.query.sport ?? "soccer").trim().toLowerCase();
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.status(400).json({ error: "q (search term) is required" });
  if (q.length > 64) return res.status(400).json({ error: "q too long" });

  try {
    const path = `livescore-get-search?sportname=${encodeURIComponent(sport)}&search=${encodeURIComponent(q)}`;
    const { status, body } = await rapidGet(SEARCH_HOST, path);
    res.status(status).json(body);
  } catch (e: any) {
    console.error("[livescore search]", e?.message ?? e);
    res.status(502).json({ error: "upstream fetch failed", detail: e?.message });
  }
});

// ---------- Cricbuzz: list live + upcoming matches ----------
router.get("/cricbuzz/list", ...adminOnly, async (_req, res) => {
  try {
    const [live, upcoming] = await Promise.all([
      rapidGet(CRIC_HOST, "matches/v1/live"),
      rapidGet(CRIC_HOST, "matches/v1/upcoming"),
    ]);
    if (live.status !== 200) return res.status(live.status).json(live.body);
    if (upcoming.status !== 200) return res.status(upcoming.status).json(upcoming.body);
    res.json({
      live: flattenCricbuzzLive(live.body),
      upcoming: flattenCricbuzzLive(upcoming.body),
    });
  } catch (e: any) {
    console.error("[cricbuzz list]", e?.message ?? e);
    res.status(502).json({ error: "upstream fetch failed", detail: e?.message });
  }
});

// ---------- Cricbuzz: link an app Match to a cricbuzz matchId ----------
router.post("/link/:appMatchId", ...adminOnly, async (req: AuthedRequest, res) => {
  const appMatchId = req.params.appMatchId;
  const cricbuzzMatchIdRaw = req.body?.cricbuzzMatchId;
  const cricbuzzMatchId = cricbuzzMatchIdRaw == null ? null : Number(cricbuzzMatchIdRaw);
  if (cricbuzzMatchIdRaw != null && !Number.isFinite(cricbuzzMatchId)) {
    return res.status(400).json({ error: "cricbuzzMatchId must be a number" });
  }

  try {
    const match = await prisma.match.update({
      where: { id: appMatchId },
      data: { cricbuzzMatchId: cricbuzzMatchId ?? null },
      select: { id: true, name: true, cricbuzzMatchId: true },
    });
    res.json({ ok: true, match });
  } catch (e: any) {
    res.status(404).json({ error: "match not found", detail: e?.message });
  }
});

// ---------- Cricbuzz: refresh scorecard for one app match ----------
router.post("/refresh/:appMatchId", ...adminOnly, async (req, res) => {
  const appMatchId = req.params.appMatchId;
  const match = await prisma.match.findUnique({ where: { id: appMatchId } });
  if (!match) return res.status(404).json({ error: "match not found" });
  if (!match.cricbuzzMatchId) {
    return res.status(400).json({ error: "no cricbuzzMatchId linked — set one first via /livescore/link" });
  }

  try {
    // Single source of truth — also runs applyIntegrityRules so markets are
    // suspended / settled in lockstep with real-world state.
    await refreshScorecardInto(appMatchId, match.cricbuzzMatchId);
    const updated = await prisma.match.findUnique({
      where: { id: appMatchId },
      select: {
        id: true, name: true, cricbuzzMatchId: true,
        liveSummary: true, liveStatus: true, liveScoreUpdatedAt: true, inPlay: true,
      },
    });
    res.json({ ok: true, match: updated });
  } catch (e: any) {
    console.error("[cricbuzz refresh]", e?.message ?? e);
    res.status(502).json({ error: "upstream fetch failed", detail: e?.message });
  }
});

// ---------- Cricbuzz: subscribe (ingest as new app match) ----------
// Pulls /mcenter/v1/{id} for the cricbuzz match, creates an app Match with
// the real teams + series name, seeds the standard Match Odds / Bookmaker /
// Ball-By-Ball markets, sets externalSource=CRICBUZZ, and pulls the first
// scorecard so the match-detail page renders live data immediately.
// Idempotent: if the same cricbuzzMatchId is already subscribed, the existing
// app match is refreshed and returned.
router.post("/cricbuzz/subscribe", ...adminOnly, async (req, res) => {
  const cricbuzzMatchId = Number(req.body?.cricbuzzMatchId);
  if (!Number.isFinite(cricbuzzMatchId) || cricbuzzMatchId <= 0) {
    return res.status(400).json({ error: "cricbuzzMatchId must be a positive number" });
  }

  // 1. Fetch match info
  let info: any;
  try {
    const { status, body } = await rapidGet(CRIC_HOST, `mcenter/v1/${cricbuzzMatchId}`);
    if (status !== 200) return res.status(status).json(body);
    info = body;
  } catch (e: any) {
    return res.status(502).json({ error: "upstream fetch failed", detail: e?.message });
  }
  if (!info?.team1?.teamname || !info?.team2?.teamname) {
    return res.status(404).json({ error: "match not found on cricbuzz" });
  }

  // 2. Idempotency: if already subscribed, refresh scorecard and return.
  const existing = await prisma.match.findUnique({
    where: { externalSource_externalId: { externalSource: "CRICBUZZ", externalId: String(cricbuzzMatchId) } },
  });
  if (existing) {
    await refreshScorecardInto(existing.id, cricbuzzMatchId);
    const updated = await prisma.match.findUnique({ where: { id: existing.id } });
    return res.json({ ok: true, alreadySubscribed: true, match: updated });
  }

  // 3. Build a new app match from cricbuzz data.
  const fmt = String(info.matchformat ?? "");
  const isLive = String(info.state ?? "").toLowerCase() === "in progress";
  const isFinished = String(info.state ?? "").toLowerCase() === "complete";
  const seriesSuffix = info.seriesname ? ` — ${info.seriesname}` : "";
  const formatSuffix = fmt ? ` (${fmt})` : "";
  const name = `${info.team1.teamname} v ${info.team2.teamname}${formatSuffix}${seriesSuffix}`;
  const startTime = info.startdate ? new Date(Number(info.startdate)) : new Date();

  const created = await prisma.match.create({
    data: {
      sport: "CRICKET",
      name,
      startTime,
      inPlay: isLive && !isFinished,
      externalSource: "CRICBUZZ",
      externalId: String(cricbuzzMatchId),
      cricbuzzMatchId,
      markets: {
        create: [
          {
            name: "Match Odds",
            type: "MATCH_ODDS",
            runners: {
              create: [
                { name: info.team1.teamname, sortOrder: 0, backOdds: 2.0,  backSize: 60000, layOdds: 2.04, laySize: 60000 },
                { name: info.team2.teamname, sortOrder: 1, backOdds: 1.95, backSize: 60000, layOdds: 1.99, laySize: 60000 },
              ],
            },
          },
          {
            name: "Bookmaker",
            type: "BOOKMAKER",
            maxStake: 50000,
            runners: {
              create: [
                { name: info.team1.teamname, sortOrder: 0, backOdds: 50, backSize: 50000, layOdds: 52, laySize: 50000 },
                { name: info.team2.teamname, sortOrder: 1, backOdds: 50, backSize: 50000, layOdds: 52, laySize: 50000 },
              ],
            },
          },
          // NOTE: Ball-By-Ball is intentionally omitted for cricbuzz-linked
          // matches — real balls can't be reliably synced with our simulated
          // ball-settlement cadence, so a user who reads the cricbuzz scorecard
          // would have a perfect-information edge on every ball.
        ],
      },
    },
  });

  // 4. Best-effort initial scorecard pull (won't fail the request if it errors).
  try { await refreshScorecardInto(created.id, cricbuzzMatchId); } catch {}

  const final = await prisma.match.findUnique({ where: { id: created.id } });
  res.json({ ok: true, created: true, match: final });
});

// Helper used by both /subscribe and /refresh — fetches scorecard, writes
// the cached fields onto the given Match row, and runs integrity rules so
// users can't bet on real-world outcomes that are already known.
async function refreshScorecardInto(appMatchId: string, cricbuzzMatchId: number) {
  const { status, body } = await rapidGet(CRIC_HOST, `mcenter/v1/${cricbuzzMatchId}/scard`);
  if (status !== 200) return;
  await prisma.match.update({
    where: { id: appMatchId },
    data: {
      liveScore: JSON.stringify(body),
      liveSummary: buildSummary(body),
      liveStatus: typeof (body as any)?.status === "string" ? (body as any).status : null,
      liveScoreUpdatedAt: new Date(),
    },
  });
  await applyIntegrityRules(appMatchId, body);
}

// Parse the winning team name from a cricbuzz status line.
// Examples:
//   "Ireland won by 9 runs"                 -> "Ireland"
//   "Bangladesh won by 5 wkts (DLS Method)" -> "Bangladesh"
//   "Match tied" / "No result"              -> null
function parseWinnerName(status: unknown): string | null {
  if (typeof status !== "string") return null;
  const m = /^(.+?)\s+won\s+by/i.exec(status.trim());
  return m ? m[1].trim() : null;
}

// Does the scorecard show that play has actually started?
// (Used to decide when to suspend betting on an in-progress match.)
function hasInningsProgress(scard: any): boolean {
  const innings = scard?.scorecard;
  if (!Array.isArray(innings) || innings.length === 0) return false;
  return innings.some((i: any) => (i?.score ?? 0) > 0 || (i?.overs ?? 0) > 0 || (i?.wickets ?? 0) > 0);
}

// Sync the app's market state to what the real match says.
//   - Complete: settle MATCH_ODDS / BOOKMAKER to the real winner; void FANCY;
//     mark the match finished. Any OPEN bets get paid out using the real
//     outcome, so users who bet *before* the data came in still get the
//     correct result.
//   - In progress (any score): SUSPEND every OPEN market on the match. New
//     bets are blocked (bets.ts rejects non-OPEN markets); existing OPEN bets
//     ride through and resolve fairly when the match completes.
//   - Not yet started: do nothing — markets remain OPEN, betting allowed.
async function applyIntegrityRules(appMatchId: string, scorecard: any) {
  const match = await prisma.match.findUnique({
    where: { id: appMatchId },
    include: { markets: { include: { runners: { select: { id: true, name: true } } } } },
  });
  if (!match) return;

  const isComplete = scorecard?.ismatchcomplete === true;
  const winnerName = parseWinnerName(scorecard?.status);

  if (isComplete) {
    for (const market of match.markets) {
      if (market.status !== "OPEN") continue;

      if (market.type === "MATCH_ODDS" || market.type === "BOOKMAKER") {
        const winnerRunner = winnerName
          ? market.runners.find(r => r.name.toLowerCase() === winnerName.toLowerCase())
            ?? market.runners.find(r =>
                r.name.toLowerCase().includes(winnerName.toLowerCase()) ||
                winnerName.toLowerCase().includes(r.name.toLowerCase()))
          : null;

        if (winnerRunner) {
          await settlementEngine.settleMarket(market.id, winnerRunner.id);
        } else {
          // No mappable winner (tie, no-result, or mismatched runner names).
          // Close the market — the orphan sweep will refund OPEN bets.
          await prisma.market.update({ where: { id: market.id }, data: { status: "CLOSED" } });
        }
      } else if (market.type === "FANCY") {
        // Real balls can't be reproduced from a finished scorecard — refund.
        await prisma.market.update({ where: { id: market.id }, data: { status: "CLOSED" } });
      }
    }
    if (match.inPlay) {
      await prisma.match.update({ where: { id: appMatchId }, data: { inPlay: false } });
    }
    console.log(`[livescore] match ${match.name} settled from cricbuzz (winner=${winnerName ?? "tie/no-result"})`);
  } else if (hasInningsProgress(scorecard)) {
    const r = await prisma.market.updateMany({
      where: { matchId: appMatchId, status: "OPEN" },
      data: { status: "SUSPENDED" },
    });
    if (r.count > 0) {
      console.log(`[livescore] match ${match.name} in progress — suspended ${r.count} OPEN market(s)`);
    }
  }
}

// ---------- Cricbuzz: refresh every linked match (one button) ----------
router.post("/refresh-all", ...adminOnly, async (_req, res) => {
  const matches = await prisma.match.findMany({
    where: { cricbuzzMatchId: { not: null } },
    select: { id: true, cricbuzzMatchId: true, name: true },
  });

  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];
  for (const m of matches) {
    try {
      // Routes through the same helper so integrity rules (settle/suspend)
      // apply uniformly across every refresh path.
      await refreshScorecardInto(m.id, m.cricbuzzMatchId!);
      results.push({ id: m.id, name: m.name, ok: true });
    } catch (e: any) {
      results.push({ id: m.id, name: m.name, ok: false, error: e?.message });
    }
  }

  res.json({ refreshed: results.length, results });
});

// ---------- helpers ----------

// Walk the nested cricbuzz live response and pull out a flat list of matches.
function flattenCricbuzzLive(payload: any): any[] {
  const out: any[] = [];
  const types = payload?.typeMatches ?? [];
  for (const t of types) {
    const seriesList = t?.seriesMatches ?? [];
    for (const s of seriesList) {
      const wrapper = s?.seriesAdWrapper;
      if (!wrapper) continue;
      for (const m of wrapper.matches ?? []) {
        const info = m?.matchInfo;
        if (!info) continue;
        out.push({
          matchId: info.matchId,
          seriesId: info.seriesId,
          seriesName: info.seriesName,
          matchDesc: info.matchDesc,
          matchFormat: info.matchFormat,
          state: info.state,
          status: info.status,
          team1: info.team1?.teamName,
          team1Short: info.team1?.teamSName,
          team2: info.team2?.teamName,
          team2Short: info.team2?.teamSName,
          venue: info.venueInfo?.ground,
          startDate: info.startDate,
        });
      }
    }
  }
  return out;
}

// "IRE 150/10 (18.5), USA 141/7 (20)"
function buildSummary(scard: any): string | null {
  const innings = scard?.scorecard;
  if (!Array.isArray(innings) || innings.length === 0) return null;
  const parts: string[] = [];
  for (const inn of innings) {
    const team = inn.batteamsname || inn.batteamname || "?";
    const score = inn.score ?? 0;
    const wkts = inn.wickets ?? 0;
    const overs = inn.overs ?? 0;
    parts.push(`${team} ${score}/${wkts} (${overs})`);
  }
  return parts.join(", ");
}

export default router;
