import { Component, inject, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { Bet } from "../models";

@Component({
  selector: "app-bet-history",
  imports: [CommonModule],
  template: `
    <div class="market-card">
      <div class="market-head"><i class="fa fa-history me-2"></i>My Bets</div>
      @if (!auth.isAuthed()) {
        <div class="alert alert-warning m-3">Please log in to see your bets.</div>
      } @else if (loading()) {
        <div class="p-3 text-center"><span class="spinner-border spinner-border-sm"></span></div>
      } @else if (bets().length === 0) {
        <div class="p-3 text-center text-muted">No bets placed yet. Go to a match and try it.</div>
      } @else {
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead class="table-light">
              <tr>
                <th>Date</th><th>Match</th><th>Market</th><th>Selection</th>
                <th>Side</th><th>Odds</th><th>Stake</th><th>Liability</th><th>Profit</th><th>Status</th><th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              @for (b of bets(); track b.id) {
                <tr>
                  <td>{{ b.createdAt | date:'short' }}</td>
                  <td>{{ b.market.match.name }}</td>
                  <td>{{ b.market.name }}</td>
                  <td>{{ b.runner.name }}</td>
                  <td>
                    <span class="badge" [class.bg-info]="b.side === 'BACK'" [class.bg-danger]="b.side === 'LAY'">{{ b.side }}</span>
                  </td>
                  <td>{{ b.odds }}</td>
                  <td>{{ b.stake | number }}</td>
                  <td>{{ b.liability | number }}</td>
                  <td>{{ b.potentialPayout | number }}</td>
                  <td><span class="status-pill" [ngClass]="b.status.toLowerCase()">{{ b.status }}</span></td>
                  <td>{{ b.pnl !== null ? (b.pnl | number) : '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class BetHistoryComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  bets = signal<Bet[]>([]);
  loading = signal(true);

  async ngOnInit() {
    if (!this.auth.isAuthed()) {
      this.loading.set(false);
      return;
    }
    try {
      this.bets.set(await this.api.betHistory());
    } finally {
      this.loading.set(false);
    }
  }
}
