import { Component, signal, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ApiService, LivescoreSearchResponse } from "../services/api.service";

const SPORTS = [
  { value: "cricket", label: "Cricket" },
  { value: "soccer", label: "Soccer" },
  { value: "basketball", label: "Basketball" },
  { value: "tennis", label: "Tennis" },
  { value: "hockey", label: "Hockey" },
];

const IMG_BASE = "https://lsm-static-prod.livescore.com/medium/";

@Component({
  selector: "app-search",
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card mb-3">
      <div class="card-header bg-dark text-white">
        <i class="fa fa-search me-2"></i>Live Sports Search
        <small class="ms-2 opacity-75">powered by free-livescore-api</small>
      </div>
      <div class="card-body">
        <form (submit)="run($event)" class="row g-2 align-items-end">
          <div class="col-12 col-md-3">
            <label class="form-label small mb-1">Sport</label>
            <select class="form-select" [(ngModel)]="sport" name="sport">
              @for (s of sports; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </div>
          <div class="col-12 col-md-7">
            <label class="form-label small mb-1">Search team, league, or country</label>
            <input class="form-control" [(ngModel)]="query" name="q" placeholder="e.g. India, Mumbai Indians, Premier League" />
          </div>
          <div class="col-12 col-md-2 d-grid">
            <button class="btn btn-warning" type="submit" [disabled]="loading()">
              @if (loading()) {
                <span class="spinner-border spinner-border-sm me-2"></span>Searching
              } @else {
                <i class="fa fa-search me-1"></i> Search
              }
            </button>
          </div>
        </form>

        @if (error()) {
          <div class="alert alert-danger mt-3 mb-0 py-2">
            <i class="fa fa-exclamation-triangle me-1"></i>{{ error() }}
          </div>
        }
      </div>
    </div>

    @if (result()?.response; as r) {
      <div class="row g-3">
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header bg-primary text-white">
              <i class="fa fa-users me-1"></i> Teams
              <span class="badge bg-light text-dark ms-1">{{ r.Teams?.length ?? 0 }}</span>
            </div>
            <ul class="list-group list-group-flush">
              @for (t of r.Teams; track t.ID) {
                <li class="list-group-item d-flex align-items-center gap-2">
                  @if (t.Img) {
                    <img [src]="imgBase + t.Img" [alt]="t.Nm" width="28" height="28"
                         style="object-fit: contain;" (error)="onImgErr($event)" />
                  } @else {
                    <span class="badge bg-secondary" style="width:28px;height:28px;line-height:18px;">{{ t.Abr || '?' }}</span>
                  }
                  <div class="flex-grow-1">
                    <div class="fw-bold">{{ t.Nm }}</div>
                    <div class="text-muted small">
                      @if (t.CoNm) { {{ t.CoNm }} }
                      @if (t.national) { <span class="badge bg-success ms-1">National</span> }
                    </div>
                  </div>
                  <code class="text-muted small">#{{ t.ID }}</code>
                </li>
              } @empty {
                <li class="list-group-item text-center text-muted small py-3">No teams found</li>
              }
            </ul>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header bg-info text-white">
              <i class="fa fa-trophy me-1"></i> Stages / Competitions
              <span class="badge bg-light text-dark ms-1">{{ r.Stages?.length ?? 0 }}</span>
            </div>
            <ul class="list-group list-group-flush">
              @for (s of r.Stages; track s.Sid) {
                <li class="list-group-item">
                  <div class="fw-bold">{{ s.Snm }}</div>
                  <div class="text-muted small">
                    {{ s.CompN || s.Cnm }} @if (s.CompD) { · {{ s.CompD }} }
                  </div>
                </li>
              } @empty {
                <li class="list-group-item text-center text-muted small py-3">No stages found</li>
              }
            </ul>
          </div>
        </div>

        @if (r.Categories?.length) {
          <div class="col-12">
            <div class="card">
              <div class="card-header bg-secondary text-white">
                <i class="fa fa-globe me-1"></i> Categories
              </div>
              <div class="card-body py-2">
                @for (c of r.Categories; track c.Cid) {
                  <span class="badge bg-light text-dark border me-1 mb-1 p-2">
                    {{ c.Cnm }} <span class="text-muted">#{{ c.Cid }}</span>
                  </span>
                }
              </div>
            </div>
          </div>
        }
      </div>
    } @else if (!loading() && searched()) {
      <div class="alert alert-warning">No results.</div>
    }
  `,
})
export class SearchComponent {
  private api = inject(ApiService);

  sports = SPORTS;
  imgBase = IMG_BASE;

  sport = "cricket";
  query = "";
  loading = signal(false);
  searched = signal(false);
  error = signal<string | null>(null);
  result = signal<LivescoreSearchResponse | null>(null);

  async run(ev: Event) {
    ev.preventDefault();
    const q = this.query.trim();
    if (!q) {
      this.error.set("Enter a search term");
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.searched.set(true);
    try {
      const r = await this.api.searchLivescore(this.sport, q);
      this.result.set(r);
      if (r.status !== "success" && !r.response) {
        this.error.set(r.error || "Search failed");
      }
    } catch (e: any) {
      this.error.set(e?.error?.error || e?.message || "Search failed");
      this.result.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  onImgErr(ev: Event) {
    (ev.target as HTMLImageElement).style.display = "none";
  }
}
