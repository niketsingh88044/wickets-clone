import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { Bet, CricbuzzLiveMatch, DownlineUser, ExternalSubscription, Match, MatchSummary, PlaceBetRequest, ResetRequest, Role, Transaction } from "../models";
import { environment } from "../../environments/environment";

const API = environment.apiUrl;

@Injectable({ providedIn: "root" })
export class ApiService {
  private http = inject(HttpClient);

  listMatches(filter?: "in-play" | "today" | "tomorrow") {
    const url = filter ? `${API}/matches?filter=${filter}` : `${API}/matches`;
    return firstValueFrom(this.http.get<MatchSummary[]>(url));
  }

  getMatch(id: string) {
    return firstValueFrom(this.http.get<Match>(`${API}/matches/${id}`));
  }

  placeBet(req: PlaceBetRequest) {
    return firstValueFrom(
      this.http.post<{ bet: Bet; balance: number; exposure: number }>(`${API}/bets`, req)
    );
  }

  betHistory() {
    return firstValueFrom(this.http.get<Bet[]>(`${API}/bets/history`));
  }

  statement() {
    return firstValueFrom(this.http.get<Transaction[]>(`${API}/me/statement`));
  }

  // ----- admin -----
  downline(scope: "direct" | "tree" = "direct") {
    return firstValueFrom(this.http.get<DownlineUser[]>(`${API}/admin/downline?scope=${scope}`));
  }

  createAccount(req: { username: string; password: string; role: Role }) {
    return firstValueFrom(this.http.post<DownlineUser>(`${API}/admin/create-account`, req));
  }

  credit(req: { targetUserId: string; amount: number; note?: string }) {
    return firstValueFrom(this.http.post<{ ok: boolean; targetBalance: number }>(`${API}/admin/credit`, req));
  }

  // Public — no auth header required (the interceptor still attaches one if present, that's fine).
  requestPasswordReset(req: { username: string; reason: string }) {
    return firstValueFrom(
      this.http.post<{ ok: boolean; message: string }>(`${API}/auth/request-reset`, req)
    );
  }

  listResetRequests(scope: "direct" | "tree" = "direct") {
    return firstValueFrom(
      this.http.get<ResetRequest[]>(`${API}/admin/reset-requests?scope=${scope}`)
    );
  }

  approveResetRequest(id: string, req: {
    newPassword: string;
    verificationNote: string;
    attestVerified: true;
  }) {
    return firstValueFrom(
      this.http.post<{ ok: boolean; target: { id: string; username: string } }>(
        `${API}/admin/reset-requests/${id}/approve`,
        req
      )
    );
  }

  rejectResetRequest(id: string, reason: string) {
    return firstValueFrom(
      this.http.post<{ ok: boolean }>(`${API}/admin/reset-requests/${id}/reject`, { reason })
    );
  }

  deleteMatch(matchId: string) {
    return firstValueFrom(
      this.http.delete<{ ok: boolean; name: string; refundedBets: number; refundedUsers: number }>(
        `${API}/admin/matches/${matchId}`
      )
    );
  }

  regenerateFixtures() {
    return firstValueFrom(
      this.http.post<{ ok: boolean; deleted: number; generated: number }>(
        `${API}/admin/regenerate-fixtures`, {}
      )
    );
  }

  // ----- External match subscriptions (India Today) -----
  listExternalSubscriptions() {
    return firstValueFrom(this.http.get<ExternalSubscription>(`${API}/admin/external-matches`));
  }

  addExternalSubscription(externalId: string) {
    return firstValueFrom(
      this.http.post<{ ok: boolean; matchId: string }>(`${API}/admin/external-matches/add`, { externalId })
    );
  }

  removeExternalSubscription(externalId: string) {
    return firstValueFrom(
      this.http.post<{ ok: boolean }>(`${API}/admin/external-matches/remove`, { externalId })
    );
  }

  // ----- Free-livescore-api search (admin only) -----
  searchLivescore(sport: string, q: string) {
    const url = `${API}/livescore/search?sport=${encodeURIComponent(sport)}&q=${encodeURIComponent(q)}`;
    return firstValueFrom(this.http.get<LivescoreSearchResponse>(url));
  }

  // ----- Cricbuzz scoreboards (admin only) -----
  cricbuzzList() {
    return firstValueFrom(
      this.http.get<{ live: CricbuzzLiveMatch[]; upcoming: CricbuzzLiveMatch[] }>(
        `${API}/livescore/cricbuzz/list`
      )
    );
  }

  subscribeCricbuzz(cricbuzzMatchId: number) {
    return firstValueFrom(
      this.http.post<{ ok: boolean; created?: boolean; alreadySubscribed?: boolean; match: any }>(
        `${API}/livescore/cricbuzz/subscribe`, { cricbuzzMatchId }
      )
    );
  }

  linkCricbuzz(appMatchId: string, cricbuzzMatchId: number | null) {
    return firstValueFrom(
      this.http.post<{ ok: boolean }>(`${API}/livescore/link/${appMatchId}`, { cricbuzzMatchId })
    );
  }

  refreshCricbuzz(appMatchId: string) {
    return firstValueFrom(
      this.http.post<{ ok: boolean; match: any }>(`${API}/livescore/refresh/${appMatchId}`, {})
    );
  }

  refreshCricbuzzAll() {
    return firstValueFrom(
      this.http.post<{ refreshed: number; results: { id: string; name: string; ok: boolean; error?: string }[] }>(
        `${API}/livescore/refresh-all`, {}
      )
    );
  }
}

export interface LivescoreTeam {
  ID: string;
  Nm: string;
  CoNm?: string;
  CoId?: string;
  Abr?: string;
  firstColor?: string;
  secondColor?: string;
  national?: boolean;
  Img?: string;
  Spid?: number;
}

export interface LivescoreStage {
  Sid: string;
  Snm: string;
  Cnm?: string;
  CompN?: string;
  CompD?: string;
  Spid?: number;
}

export interface LivescoreCategory {
  Cid: string;
  Cnm: string;
  Ccd?: string;
  Spid?: number;
}

export interface LivescoreSearchResponse {
  status: string;
  response?: {
    Teams?: LivescoreTeam[];
    Stages?: LivescoreStage[];
    Categories?: LivescoreCategory[];
  };
  error?: string;
}
