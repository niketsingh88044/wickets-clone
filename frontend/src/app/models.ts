export type Role = "USER" | "MASTER" | "SUPER_MASTER";

export interface User {
  id: string;
  username: string;
  role: Role;
  balance: number;
  parent?: { id: string; username: string; role: Role } | null;
}

export interface ResetRequest {
  id: string;
  userId: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  resolvedAt: string | null;
  approvalNote: string | null;
  user: {
    id: string;
    username: string;
    role: Role;
    parent: { username: string; role: Role } | null;
  };
}

export interface DownlineUser {
  id: string;
  username: string;
  role: Role;
  parentId: string | null;
  parent: { username: string; role: Role } | null;
  createdAt: string;
  wallet: { balance: number; exposure: number } | null;
  _count: { children: number; bets: number };
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Balance {
  balance: number;
  exposure: number;
}

export interface Runner {
  id: string;
  marketId: string;
  name: string;
  sortOrder: number;
  backOdds: number | null;
  backSize: number | null;
  layOdds: number | null;
  laySize: number | null;
}

export interface Market {
  id: string;
  matchId: string;
  name: string;
  type: "MATCH_ODDS" | "BOOKMAKER" | "FANCY";
  status: "OPEN" | "SUSPENDED" | "CLOSED" | "SETTLED";
  minStake: number;
  maxStake: number;
  runners: Runner[];
}

export interface MarketSummary {
  id: string;
  name: string;
  type: Market["type"];
  status: Market["status"];
  runners?: { id: string; name: string; backOdds: number | null; layOdds: number | null; sortOrder: number }[];
}

export interface MarketTick {
  marketId: string;
  ts: number;
  runners: {
    id: string;
    backOdds: number | null;
    backSize: number | null;
    layOdds: number | null;
    laySize: number | null;
  }[];
}

export interface MatchSummary {
  id: string;
  sport: string;
  name: string;
  startTime: string;
  inPlay: boolean;
  externalId: string | null;
  externalSource: string | null;
  markets: MarketSummary[];
}

export interface ExternalSubscription {
  subscriptions: string[];
  matches: {
    id: string;
    name: string;
    inPlay: boolean;
    externalId: string;
    externalSource: string;
  }[];
}

export interface Match {
  id: string;
  sport: string;
  name: string;
  startTime: string;
  inPlay: boolean;
  markets: Market[];
  // --- Live scorecard (Cricbuzz) cache. Populated only after admin presses
  // refresh; will be null on fresh seeds.
  cricbuzzMatchId?: number | null;
  liveScore?: string | null;          // raw JSON string of the cricbuzz scorecard
  liveSummary?: string | null;
  liveStatus?: string | null;
  liveScoreUpdatedAt?: string | null;
}

export interface CricbuzzLiveMatch {
  matchId: number;
  seriesId?: number;
  seriesName?: string;
  matchDesc?: string;
  matchFormat?: string;
  state?: string;
  status?: string;
  team1?: string;
  team1Short?: string;
  team2?: string;
  team2Short?: string;
  venue?: string;
  startDate?: string;
}

// --- Cricbuzz scorecard payload (what the API gives back, stored as JSON
// in Match.liveScore). Only the fields we render are typed; the rest stays
// as unknown so the engine can evolve.
export interface CricbuzzBatsman {
  id: number;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strkrate: string;
  outdec: string;
  iscaptain: boolean;
  iskeeper: boolean;
}
export interface CricbuzzBowler {
  id: number;
  name: string;
  overs: string;
  maidens: number;
  wickets: number;
  runs: number;
  economy: string;
}
export interface CricbuzzFow {
  batsmanname: string;
  overnbr: number;
  runs: number;
  ballnbr: number;
}
export interface CricbuzzInnings {
  inningsid: number;
  batteamname: string;
  batteamsname: string;
  score: number;
  wickets: number;
  overs: number;
  runrate: number;
  extras?: { wides: number; noballs: number; byes: number; legbyes: number; penalty: number; total: number };
  batsman: CricbuzzBatsman[];
  bowler: CricbuzzBowler[];
  fow?: { fow: CricbuzzFow[] };
}
export interface CricbuzzScorecard {
  scorecard: CricbuzzInnings[];
  status?: string;
  ismatchcomplete?: boolean;
  responselastupdated?: number;
}

export interface BetSlipSelection {
  market: Market;
  runner: Runner;
  side: "BACK" | "LAY";
  odds: number;
}

export interface PlaceBetRequest {
  marketId: string;
  runnerId: string;
  side: "BACK" | "LAY";
  odds: number;
  stake: number;
}

export interface Bet {
  id: string;
  side: "BACK" | "LAY";
  odds: number;
  stake: number;
  liability: number;
  potentialPayout: number;
  status: "OPEN" | "WON" | "LOST" | "VOID";
  pnl: number | null;
  createdAt: string;
  runner: { name: string };
  market: { name: string; match: { name: string } };
}

export interface Transaction {
  id: string;
  amount: number;
  type: string;
  note: string | null;
  createdAt: string;
}
