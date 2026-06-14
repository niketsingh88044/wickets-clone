import { Component, inject, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { Transaction } from "../models";

@Component({
  selector: "app-profile",
  imports: [CommonModule],
  template: `
    @if (!auth.isAuthed()) {
      <div class="alert alert-warning">Please log in.</div>
    } @else {
      <div class="market-card">
        <div class="market-head"><i class="fa fa-id-card me-2"></i>My Profile</div>
        <div class="p-3">
          <div class="row">
            <div class="col-md-6">
              <div><strong>Username:</strong> {{ auth.user()?.username }}</div>
              <div><strong>User ID:</strong> <code>{{ auth.user()?.id }}</code></div>
            </div>
            <div class="col-md-6">
              <div>Wallet balance: <strong class="text-success">{{ auth.balance() | number:'1.2-2' }} PTI</strong></div>
              <div>Exposure: <strong class="text-warning">{{ auth.exposure() | number:'1.0-0' }} PTI</strong></div>
              <div>Total: <strong>{{ (auth.balance() + auth.exposure()) | number:'1.2-2' }} PTI</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div class="market-card mt-3">
        <div class="market-head"><i class="fa fa-list me-2"></i>Account Statement</div>
        @if (loading()) {
          <div class="p-3 text-center"><span class="spinner-border spinner-border-sm"></span></div>
        } @else {
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light"><tr><th>Date</th><th>Type</th><th>Note</th><th class="text-end">Amount</th></tr></thead>
              <tbody>
                @for (t of txns(); track t.id) {
                  <tr>
                    <td>{{ t.createdAt | date:'short' }}</td>
                    <td><span class="badge bg-secondary">{{ t.type }}</span></td>
                    <td>{{ t.note }}</td>
                    <td class="text-end" [class.text-success]="t.amount >= 0" [class.text-danger]="t.amount < 0">
                      {{ t.amount > 0 ? '+' : '' }}{{ t.amount | number:'1.0-2' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
})
export class ProfileComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  txns = signal<Transaction[]>([]);
  loading = signal(true);

  async ngOnInit() {
    if (!this.auth.isAuthed()) {
      this.loading.set(false);
      return;
    }
    try {
      this.txns.set(await this.api.statement());
    } finally {
      this.loading.set(false);
    }
  }
}
