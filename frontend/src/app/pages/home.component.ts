import { Component, DestroyRef, inject, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ApiService } from "../services/api.service";
import { OddsStreamService } from "../services/odds-stream.service";
import { MatchSummary, MarketTick } from "../models";

type Filter = "in-play" | "today" | "tomorrow" | "all";

@Component({
  selector: "app-home",
  imports: [CommonModule, RouterLink],
  template: `
    <div class="market-card">
      <div class="market-head d-flex align-items-center">
        <span><i class="fa fa-baseball-ball me-2"></i>Cricket</span>
        <div class="btn-group btn-group-sm ms-3" role="group">
          <button class="btn" [class.btn-warning]="filter() === 'in-play'" [class.btn-outline-light]="filter() !== 'in-play'" (click)="setFilter('in-play')">
            <i class="fa fa-circle text-danger me-1" style="font-size:8px"></i>In-Play
          </button>
          <button class="btn" [class.btn-warning]="filter() === 'today'" [class.btn-outline-light]="filter() !== 'today'" (click)="setFilter('today')">Today</button>
          <button class="btn" [class.btn-warning]="filter() === 'tomorrow'" [class.btn-outline-light]="filter() !== 'tomorrow'" (click)="setFilter('tomorrow')">Tomorrow</button>
          <button class="btn" [class.btn-warning]="filter() === 'all'" [class.btn-outline-light]="filter() !== 'all'" (click)="setFilter('all')">All</button>
        </div>
        <span class="ms-auto small">
          <i class="fa fa-circle text-success me-1" style="font-size:8px; animation: pulse 1.5s infinite;"></i>
          Live odds streaming
        </span>
      </div>

      <div class="d-grid" style="grid-template-columns: 1fr 60px 60px 60px 60px 60px 60px; padding: 4px 8px; background:#eee; font-size:11px; font-weight:600; color:#555">
        <span></span><span class="text-center">1 (back)</span><span class="text-center">1 (lay)</span><span class="text-center">X (back)</span><span class="text-center">X (lay)</span><span class="text-center">2 (back)</span><span class="text-center">2 (lay)</span>
      </div>

      @if (loading()) {
        <div class="p-3 text-center text-muted">
          <span class="spinner-border spinner-border-sm me-2"></span>Loading matches…
        </div>
      } @else if (error()) {
        <div class="alert alert-danger m-3">
          {{ error() }}
          <div class="mt-2"><small>Make sure backend is running on <code>http://localhost:4000</code>.</small></div>
        </div>
      } @else {
        @for (m of matches(); track m.id) {
          @let mo = getMatchOdds(m);
          <a class="match-row text-decoration-none text-dark" [routerLink]="['/match', m.id]">
            <div class="name">
              @if (m.externalSource) {
                <span class="badge bg-danger me-1" title="Real live data from {{ m.externalSource }}">
                  <i class="fa fa-circle me-1" style="font-size:8px; animation: pulse 1.2s infinite"></i>LIVE
                </span>
              }
              {{ m.name }}
              @if (m.inPlay) { <span class="in-play">In-Play</span> }
              @else { <span class="text-muted small ms-2">{{ m.startTime | date:'short' }}</span> }
            </div>
            @for (cell of mo; track $index) {
              <div class="cell" [class.back]="cell.side === 'BACK'" [class.lay]="cell.side === 'LAY'">
                <div>{{ cell.odds ?? '-' }}</div>
              </div>
            }
          </a>
        } @empty {
          <div class="p-3 text-center text-muted">No matches in this filter.</div>
        }
      }
    </div>

    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    </style>
  `,
})
export class HomeComponent implements OnInit {
  private api = inject(ApiService);
  private stream = inject(OddsStreamService);
  private destroyRef = inject(DestroyRef);

  matches = signal<MatchSummary[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  filter = signal<Filter>("in-play");

  async ngOnInit() {
    await this.refresh();
    // Subscribe once; the stream stays open while this component is alive.
    this.stream.all().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(tick => this.applyTick(tick));
  }

  async setFilter(f: Filter) {
    this.filter.set(f);
    await this.refresh();
  }

  private async refresh() {
    this.loading.set(true);
    try {
      const f = this.filter();
      const ms = await this.api.listMatches(f === "all" ? undefined : f);
      this.matches.set(ms);
      this.error.set(null);
    } catch (e: any) {
      this.error.set(e?.message ?? "Failed to load matches");
    } finally {
      this.loading.set(false);
    }
  }

  // Build 6 cells aligned to the 1/X/2 columns.
  // For 3-runner markets (Tests with Draw) → [team1, Draw, team2]
  // For 2-runner markets (T20/ODI/IPL etc) → [team1, _, team2] (X column empty)
  getMatchOdds(m: MatchSummary): { side: "BACK" | "LAY"; odds: number | null }[] {
    const mo = m.markets.find(x => x.type === "MATCH_ODDS");
    const runners = mo?.runners ?? [];
    const hasDraw = runners.some(r => r.name.toLowerCase() === "draw");

    let slots: (typeof runners[number] | null)[];
    if (hasDraw) {
      slots = [runners[0] ?? null, runners.find(r => r.name.toLowerCase() === "draw") ?? null, runners[2] ?? null];
    } else {
      slots = [runners[0] ?? null, null, runners[1] ?? null];
    }

    const cells: { side: "BACK" | "LAY"; odds: number | null }[] = [];
    for (const r of slots) {
      cells.push({ side: "BACK", odds: r?.backOdds ?? null });
      cells.push({ side: "LAY", odds: r?.layOdds ?? null });
    }
    return cells;
  }

  private applyTick(tick: MarketTick) {
    this.matches.update(arr =>
      arr.map(m => {
        const mIdx = m.markets.findIndex(x => x.id === tick.marketId);
        if (mIdx < 0) return m;
        const market = m.markets[mIdx];
        const updatedRunners = (market.runners ?? []).map(r => {
          const u = tick.runners.find(x => x.id === r.id);
          if (!u) return r;
          return { ...r, backOdds: u.backOdds, layOdds: u.layOdds };
        });
        const updatedMarkets = [...m.markets];
        updatedMarkets[mIdx] = { ...market, runners: updatedRunners };
        return { ...m, markets: updatedMarkets };
      })
    );
  }
}
