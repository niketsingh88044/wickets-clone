import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../services/auth.service";

declare const bootstrap: any;

@Component({
  selector: "app-withdraw-modal",
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal fade" tabindex="-1" id="withdrawModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header" style="background: #c97a00; color: #fff;">
            <h5 class="modal-title">
              <i class="fa fa-arrow-up me-2"></i>Withdraw chips to parent
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" (click)="reset()"></button>
          </div>
          <div class="modal-body">
            @if (!auth.user()?.parent) {
              <div class="alert alert-warning py-2 small">
                You have no parent account — nothing to withdraw to.
              </div>
            } @else {
              <div class="alert alert-info py-2 small">
                Sending chips from <code>{{ auth.user()?.username }}</code>
                (<strong>{{ auth.role() }}</strong>) up to
                <code>{{ auth.user()?.parent?.username }}</code>
                (<strong>{{ auth.user()?.parent?.role }}</strong>).
              </div>
              <div class="row mb-2 small">
                <div class="col-6">Your balance: <strong>{{ auth.balance() | number:'1.0-2' }} PTI</strong></div>
                <div class="col-6">Exposure (locked): <strong class="text-warning">{{ auth.exposure() | number:'1.0-0' }}</strong></div>
              </div>

              <form (ngSubmit)="submit()">
                <div class="mb-2">
                  <label class="form-label small fw-bold">
                    Amount <span class="text-danger">*</span>
                  </label>
                  <input class="form-control form-control-sm" type="number" name="amt"
                         [(ngModel)]="amount" min="1" [max]="auth.balance()" required
                         [class.is-invalid]="amount > auth.balance() || amount <= 0"
                         [class.is-valid]="amount > 0 && amount <= auth.balance()">
                  <div class="quick-stake mt-2">
                    @for (q of quickAmounts(); track q) {
                      <button type="button" class="btn btn-outline-secondary btn-sm" (click)="amount = q">{{ q }}</button>
                    }
                    <button type="button" class="btn btn-outline-warning btn-sm" (click)="amount = auth.balance()">All</button>
                  </div>
                </div>

                <div class="mb-2">
                  <label class="form-label small">Note (optional)</label>
                  <input class="form-control form-control-sm" type="text" [(ngModel)]="note" name="note" maxlength="200"
                         placeholder="e.g. settlement Sun">
                </div>

                @if (error()) { <div class="alert alert-danger py-2 small">{{ error() }}</div> }
                @if (ok()) {
                  <div class="alert alert-success py-2 small">
                    <i class="fa fa-check-circle"></i> Sent {{ sentAmount() | number }} PTI to
                    <code>{{ auth.user()?.parent?.username }}</code>. Your new balance: <strong>{{ auth.balance() | number:'1.0-2' }} PTI</strong>.
                  </div>
                }

                @if (!ok() && blockers.length > 0) {
                  <div class="alert alert-warning py-2 small mb-2">
                    <i class="fa fa-info-circle"></i> Still needed:
                    <ul class="mb-0 mt-1">
                      @for (b of blockers; track b) { <li>{{ b }}</li> }
                    </ul>
                  </div>
                }

                <div class="d-flex gap-2 mt-2">
                  <button type="button" class="btn btn-secondary flex-grow-1" data-bs-dismiss="modal" (click)="reset()">
                    {{ ok() ? 'Close' : 'Cancel' }}
                  </button>
                  <button type="submit" class="btn btn-warning flex-grow-1"
                          [disabled]="busy() || blockers.length > 0 || ok()">
                    @if (busy()) {<span class="spinner-border spinner-border-sm me-2"></span>}
                    Send {{ amount | number }} PTI
                  </button>
                </div>
              </form>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class WithdrawModalComponent {
  protected auth = inject(AuthService);
  private modal: any;

  amount = 0;
  note = "";
  busy = signal(false);
  error = signal<string | null>(null);
  ok = signal(false);
  sentAmount = signal(0);

  get blockers(): string[] {
    const items: string[] = [];
    if (this.amount <= 0) items.push("Amount must be positive");
    if (this.amount > this.auth.balance()) items.push(`Amount exceeds your balance (${this.auth.balance()})`);
    return items;
  }

  quickAmounts(): number[] {
    const bal = this.auth.balance();
    return [100, 500, 1000, 5000].filter(q => q <= bal);
  }

  show() {
    this.reset();
    const el = document.getElementById("withdrawModal");
    if (!this.modal && el) this.modal = new bootstrap.Modal(el);
    this.modal?.show();
  }

  reset() {
    this.amount = 0;
    this.note = "";
    this.error.set(null);
    this.ok.set(false);
  }

  async submit() {
    if (this.blockers.length) return;
    this.busy.set(true);
    this.error.set(null);
    this.ok.set(false);
    try {
      const amt = Number(this.amount);
      await this.auth.withdrawToParent(amt, this.note || undefined);
      this.sentAmount.set(amt);
      this.ok.set(true);
      this.amount = 0;
      this.note = "";
    } catch (e: any) {
      this.error.set(extractError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

function extractError(e: any): string {
  const err = e?.error?.error;
  if (typeof err === "string") return err;
  if (err?.fieldErrors) {
    return Object.entries(err.fieldErrors)
      .map(([f, v]) => `${f}: ${(v as string[]).join(", ")}`)
      .join("; ");
  }
  if (Array.isArray(err?.formErrors) && err.formErrors.length) return err.formErrors.join(", ");
  return e?.message ?? "Failed";
}
