import { Component, computed, DestroyRef, inject, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { BetSlipService } from "../services/bet-slip.service";
import { OddsStreamService } from "../services/odds-stream.service";
import { CricbuzzScorecard, Market, MarketTick, Match, Runner } from "../models";

@Component({
  selector: "app-match-detail",
  imports: [CommonModule, FormsModule],
  template: `
    @if (loading()) {
      <div class="p-3 text-center text-muted">
        <span class="spinner-border spinner-border-sm me-2"></span>Loading match…
      </div>
    } @else if (error()) {
      <div class="alert alert-danger">{{ error() }}</div>
    } @else if (match()) {
      <div class="row g-2">
        <div class="col-12 col-lg-9">
          <div class="market-card">
            <div class="market-head">
              <span><i class="fa fa-baseball-ball me-2"></i>{{ match()!.name }}</span>
              @if (match()!.inPlay) { <span class="badge bg-danger">IN-PLAY</span> }
            </div>
          </div>

          @if (scorecard(); as sc) {
            @if (anyMarketLocked()) {
              <div class="alert alert-warning d-flex align-items-center mb-2 py-2" role="alert">
                <i class="fa fa-lock me-2"></i>
                <div class="small">
                  <strong>Betting suspended on this match.</strong>
                  Live scores are being pulled from a real-world feed, so new bets are blocked
                  to prevent betting on outcomes that have already happened.
                  Existing open bets will settle automatically when the real match finishes.
                </div>
              </div>
            }
            <div class="market-card">
              <div class="market-head" style="background:#0d6efd">
                <i class="fa fa-trophy me-2"></i>Live Scorecard
                @if (match()!.liveSummary) {
                  <span class="ms-2"><strong>{{ match()!.liveSummary }}</strong></span>
                }
                @if (match()!.liveStatus) {
                  <span class="badge bg-warning text-dark ms-2">{{ match()!.liveStatus }}</span>
                }
                @if (match()!.liveScoreUpdatedAt) {
                  <span class="small ms-auto opacity-75">updated {{ match()!.liveScoreUpdatedAt | date:'shortTime' }}</span>
                }
              </div>

              <div class="p-2">
                @for (inn of sc.scorecard; track inn.inningsid) {
                  <details [attr.open]="inn.inningsid === sc.scorecard.length ? '' : null" class="mb-2">
                    <summary class="d-flex align-items-center gap-2 py-1" style="cursor:pointer;">
                      <span class="badge bg-dark">{{ inn.inningsid === 1 ? '1st' : (inn.inningsid === 2 ? '2nd' : inn.inningsid + 'th') }} innings</span>
                      <strong>{{ inn.batteamname }}</strong>
                      <span class="ms-2">{{ inn.score }}/{{ inn.wickets }} ({{ inn.overs }} ov)</span>
                      <span class="text-muted small ms-2">RR {{ inn.runrate }}</span>
                    </summary>

                    <div class="row g-2 mt-1">
                      <div class="col-12 col-md-7">
                        <div class="small fw-bold mb-1">Batting</div>
                        <div class="table-responsive">
                          <table class="table table-sm mb-0">
                            <thead class="table-light">
                              <tr><th>Batter</th><th class="text-end">R</th><th class="text-end">B</th><th class="text-end">4s</th><th class="text-end">6s</th><th class="text-end">SR</th></tr>
                            </thead>
                            <tbody>
                              @for (b of inn.batsman; track b.id) {
                                <tr>
                                  <td>
                                    {{ b.name }}
                                    @if (b.iscaptain) { <span class="badge bg-warning text-dark ms-1" style="font-size:9px">C</span> }
                                    @if (b.iskeeper) { <span class="badge bg-info ms-1" style="font-size:9px">WK</span> }
                                    @if (b.outdec) { <br><small class="text-muted">{{ b.outdec }}</small> }
                                  </td>
                                  <td class="text-end fw-bold">{{ b.runs }}</td>
                                  <td class="text-end">{{ b.balls }}</td>
                                  <td class="text-end">{{ b.fours }}</td>
                                  <td class="text-end">{{ b.sixes }}</td>
                                  <td class="text-end small">{{ b.strkrate }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div class="col-12 col-md-5">
                        <div class="small fw-bold mb-1">Bowling</div>
                        <div class="table-responsive">
                          <table class="table table-sm mb-0">
                            <thead class="table-light">
                              <tr><th>Bowler</th><th class="text-end">O</th><th class="text-end">M</th><th class="text-end">R</th><th class="text-end">W</th><th class="text-end">Econ</th></tr>
                            </thead>
                            <tbody>
                              @for (bw of inn.bowler; track bw.id) {
                                <tr>
                                  <td>{{ bw.name }}</td>
                                  <td class="text-end">{{ bw.overs }}</td>
                                  <td class="text-end">{{ bw.maidens }}</td>
                                  <td class="text-end">{{ bw.runs }}</td>
                                  <td class="text-end fw-bold">{{ bw.wickets }}</td>
                                  <td class="text-end small">{{ bw.economy }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        </div>

                        @if (inn.extras) {
                          <div class="small text-muted mt-2">
                            Extras: <strong>{{ inn.extras.total }}</strong>
                            (b {{ inn.extras.byes }}, lb {{ inn.extras.legbyes }}, w {{ inn.extras.wides }}, nb {{ inn.extras.noballs }})
                          </div>
                        }
                        @if (inn.fow?.fow?.length) {
                          <div class="small text-muted mt-1">
                            <strong>FoW:</strong>
                            @for (f of inn.fow!.fow; track $index; let last = $last) {
                              {{ f.runs }}-{{ $index + 1 }} ({{ f.batsmanname }}, {{ f.overnbr }} ov){{ last ? '' : ' · ' }}
                            }
                          </div>
                        }
                      </div>
                    </div>
                  </details>
                }
              </div>
            </div>
          }

          @for (mkt of (match()!.markets); track mkt.id) {
            <div class="market-card">
              <div class="market-head">
                <span>{{ mkt.name }}</span>
                <span style="font-size:11px">
                  Min: {{ mkt.minStake | number }} &middot; Max: {{ mkt.maxStake | number }} &middot;
                  Status: <span [class.text-warning]="mkt.status !== 'OPEN'">{{ mkt.status }}</span>
                </span>
              </div>

              @if (mkt.type === 'FANCY') {
                <div class="fancy-grid">
                  <div class="head" style="grid-column: 1 / 4;">Runs (back-only)</div>
                  @for (r of mkt.runners; track r.id) {
                    <div>{{ r.name }}</div>
                    <div class="cell back" (click)="select(mkt, r, 'BACK', r.backOdds)">
                      <div class="odds">{{ r.backOdds ?? '-' }}</div>
                      <div class="size">{{ r.backSize | number }}</div>
                    </div>
                    <div></div>
                  }
                </div>
              } @else {
                <div class="runner-grid">
                  <div class="head">Runner</div>
                  <div class="head" style="background:#a0d3f7">Back</div>
                  <div class="head" style="background:#f7c4d2">Lay</div>
                  @for (r of mkt.runners; track r.id) {
                    <div>{{ r.name }}</div>
                    <div class="cell back" (click)="select(mkt, r, 'BACK', r.backOdds)">
                      <div class="odds">{{ r.backOdds ?? '-' }}</div>
                      <div class="size">{{ r.backSize | number }}</div>
                    </div>
                    <div class="cell lay" (click)="select(mkt, r, 'LAY', r.layOdds)">
                      <div class="odds">{{ r.layOdds ?? '-' }}</div>
                      <div class="size">{{ r.laySize | number }}</div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>

        <div class="col-12 col-lg-3">
          @if (slip.selection(); as sel) {
            <div class="bet-slip" [class.back]="sel.side === 'BACK'" [class.lay]="sel.side === 'LAY'">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <strong>{{ sel.side }} Bet</strong>
                <button class="btn-close" (click)="slip.clear()"></button>
              </div>
              <div class="text-muted small">{{ sel.market.name }}</div>
              <div class="fw-bold">{{ sel.runner.name }}</div>

              <div class="row g-2 mt-2">
                <div class="col-6">
                  <label class="form-label small">Odds</label>
                  <input class="form-control form-control-sm" type="number" step="0.01" [(ngModel)]="oddsInput">
                </div>
                <div class="col-6">
                  <label class="form-label small">Stake (PTI)</label>
                  <input class="form-control form-control-sm" type="number" [(ngModel)]="stakeInput">
                </div>
              </div>

              <div class="quick-stake">
                @for (q of quickStakes; track q) {
                  <button class="btn btn-outline-secondary btn-sm" (click)="stakeInput = q">{{ q }}</button>
                }
              </div>

              <div class="bg-light p-2 rounded mb-2" style="font-size: 12px;">
                @if (sel.side === 'BACK') {
                  <div>Stake (risk): <strong>{{ stakeInput | number }}</strong></div>
                  <div>Profit if wins: <strong class="text-success">{{ profit() | number:'1.0-2' }}</strong></div>
                } @else {
                  <div>Liability (risk): <strong class="text-danger">{{ liability() | number:'1.0-2' }}</strong></div>
                  <div>Profit if wins: <strong class="text-success">{{ stakeInput | number }}</strong></div>
                }
              </div>

              @if (placeError()) { <div class="alert alert-danger py-1 small">{{ placeError() }}</div> }
              @if (placeOk()) {
                <div class="alert alert-success py-1 small">
                  Bet placed. New balance: <strong>{{ auth.balance() | number:'1.0-2' }}</strong>
                </div>
              }

              @if (!auth.isAuthed()) {
                <div class="alert alert-warning py-1 small">Login or register to place bets.</div>
              }
              <button class="btn btn-success w-100" (click)="placeBet()"
                      [disabled]="!auth.isAuthed() || placing() || !stakeInput">
                @if (placing()) {<span class="spinner-border spinner-border-sm me-2"></span>}
                Place Bet
              </button>
            </div>
          } @else {
            <div class="bet-slip">
              <div class="text-muted text-center">
                <i class="fa fa-hand-pointer fa-2x mb-2"></i>
                <div>Click any odds cell to open the bet slip.</div>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class MatchDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private stream = inject(OddsStreamService);
  private destroyRef = inject(DestroyRef);
  protected slip = inject(BetSlipService);
  protected auth = inject(AuthService);

  match = signal<Match | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  placing = signal(false);
  placeError = signal<string | null>(null);
  placeOk = signal(false);

  oddsInput = 0;
  stakeInput = 100;
  quickStakes = [100, 500, 1000, 5000];

  // True when at least one market on this match isn't OPEN — i.e. the
  // livescore integrity rule has locked or settled betting.
  anyMarketLocked = computed(() => {
    const m = this.match();
    if (!m) return false;
    return m.markets.some(mk => mk.status !== "OPEN");
  });

  // Parse the cached scorecard JSON from Match.liveScore. Returns null when
  // the admin hasn't pressed "Refresh" for this match yet.
  scorecard = computed<CricbuzzScorecard | null>(() => {
    const m = this.match();
    if (!m?.liveScore) return null;
    try {
      const parsed = JSON.parse(m.liveScore);
      return Array.isArray(parsed?.scorecard) ? (parsed as CricbuzzScorecard) : null;
    } catch {
      return null;
    }
  });

  profit = computed(() => {
    const sel = this.slip.selection();
    if (!sel) return 0;
    return Number(this.stakeInput) * (Number(this.oddsInput) - 1);
  });
  liability = computed(() => {
    const sel = this.slip.selection();
    if (!sel) return 0;
    return Number(this.stakeInput) * (Number(this.oddsInput) - 1);
  });

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get("id")!;
    try {
      const m = await this.api.getMatch(id);
      this.match.set(m);
      // Subscribe to live odds for each market on this match.
      for (const mkt of m.markets) {
        this.stream.market(mkt.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(tick => this.applyTick(tick));
      }
    } catch (e: any) {
      this.error.set(e?.message ?? "Failed to load match");
    } finally {
      this.loading.set(false);
    }
  }

  private applyTick(tick: MarketTick) {
    this.match.update(m => {
      if (!m) return m;
      const mIdx = m.markets.findIndex(x => x.id === tick.marketId);
      if (mIdx < 0) return m;
      const market = m.markets[mIdx];
      const newRunners = market.runners.map(r => {
        const u = tick.runners.find(x => x.id === r.id);
        if (!u) return r;
        return { ...r, backOdds: u.backOdds, backSize: u.backSize, layOdds: u.layOdds, laySize: u.laySize };
      });
      const newMarkets = [...m.markets];
      newMarkets[mIdx] = { ...market, runners: newRunners };
      return { ...m, markets: newMarkets };
    });
  }

  select(market: Market, runner: Runner, side: "BACK" | "LAY", odds: number | null) {
    if (!odds) return;
    this.placeOk.set(false);
    this.placeError.set(null);
    this.slip.open({ market, runner, side, odds });
    this.oddsInput = odds;
    this.stakeInput = market.minStake;
  }

  async placeBet() {
    const sel = this.slip.selection();
    if (!sel) return;
    this.placing.set(true);
    this.placeError.set(null);
    this.placeOk.set(false);
    try {
      const res = await this.api.placeBet({
        marketId: sel.market.id,
        runnerId: sel.runner.id,
        side: sel.side,
        odds: Number(this.oddsInput),
        stake: Number(this.stakeInput),
      });
      this.auth.setBalance(res.balance, res.exposure);
      this.placeOk.set(true);
      this.slip.clear();
    } catch (e: any) {
      this.placeError.set(e?.error?.error?.toString?.() ?? e?.message ?? "Failed");
    } finally {
      this.placing.set(false);
    }
  }
}
