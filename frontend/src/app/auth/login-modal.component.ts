import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../services/auth.service";
import { ApiService } from "../services/api.service";

declare const bootstrap: any;

@Component({
  selector: "app-login-modal",
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal fade" tabindex="-1" #modalEl id="loginModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header" style="background: var(--wk-green); color: #fff;">
            <h5 class="modal-title">
              @if (mode() === 'login') { Login to Wickets }
              @else { Request Password Reset }
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            @if (mode() === 'login') {
              <form (ngSubmit)="submitLogin()">
                <div class="mb-3">
                  <label class="form-label">Username</label>
                  <input class="form-control" type="text" [(ngModel)]="username" name="username"
                         autocomplete="username" minlength="3" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Password</label>
                  <input class="form-control" type="password" [(ngModel)]="password" name="password"
                         autocomplete="current-password" minlength="6" required>
                </div>
                @if (error()) {
                  <div class="alert alert-danger py-2 small">
                    {{ error() }}
                    <div class="mt-1">
                      <a href="javascript:void(0)" (click)="switchToRequest()" class="alert-link">
                        Forgot password? Request a reset →
                      </a>
                    </div>
                  </div>
                }
                <div class="alert alert-info py-2 small">
                  <i class="fa fa-info-circle"></i> Accounts are issued by a master or super-master.
                  No public signup.
                </div>
                <button type="submit" class="btn btn-success w-100" [disabled]="busy()">
                  @if (busy()) {<span class="spinner-border spinner-border-sm me-2"></span>}
                  Login
                </button>
                <div class="text-center mt-2">
                  <a href="javascript:void(0)" (click)="switchToRequest()" class="small text-muted">
                    Forgot password?
                  </a>
                </div>
              </form>
            } @else {
              <form (ngSubmit)="submitRequest()">
                <div class="alert alert-warning py-2 small">
                  <i class="fa fa-exclamation-triangle"></i>
                  Your master / admin will be notified. Contact them via WhatsApp or phone
                  to verify and approve the reset.
                </div>
                <div class="mb-3">
                  <label class="form-label">Username</label>
                  <input class="form-control" type="text" [(ngModel)]="username" name="username"
                         autocomplete="username" minlength="3" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Reason</label>
                  <textarea class="form-control" rows="2" [(ngModel)]="reason" name="reason"
                            placeholder="e.g. forgot my password" minlength="5" maxlength="300" required></textarea>
                </div>
                @if (error()) { <div class="alert alert-danger py-2 small">{{ error() }}</div> }
                @if (requestOk()) {
                  <div class="alert alert-success py-2 small">
                    <i class="fa fa-check-circle"></i> {{ requestOk() }}
                  </div>
                }
                <button type="submit" class="btn btn-warning w-100" [disabled]="busy() || !!requestOk()">
                  @if (busy()) {<span class="spinner-border spinner-border-sm me-2"></span>}
                  Submit request
                </button>
                <div class="text-center mt-2">
                  <a href="javascript:void(0)" (click)="switchToLogin()" class="small">
                    ← Back to login
                  </a>
                </div>
              </form>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoginModalComponent {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private modal: any;

  mode = signal<"login" | "request">("login");
  username = "";
  password = "";
  reason = "";
  busy = signal(false);
  error = signal<string | null>(null);
  requestOk = signal<string | null>(null);

  ngAfterViewInit() {
    const el = document.getElementById("loginModal");
    if (el) this.modal = new bootstrap.Modal(el);
  }

  show() {
    this.error.set(null);
    this.requestOk.set(null);
    this.mode.set("login");
    if (!this.modal) {
      const el = document.getElementById("loginModal");
      if (el) this.modal = new bootstrap.Modal(el);
    }
    this.modal?.show();
  }

  switchToRequest() {
    this.mode.set("request");
    this.error.set(null);
    this.requestOk.set(null);
    this.password = "";
  }

  switchToLogin() {
    this.mode.set("login");
    this.error.set(null);
    this.requestOk.set(null);
    this.reason = "";
  }

  async submitLogin() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.username, this.password);
      this.modal?.hide();
      this.username = "";
      this.password = "";
    } catch (e: any) {
      this.error.set(extractError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async submitRequest() {
    this.busy.set(true);
    this.error.set(null);
    this.requestOk.set(null);
    try {
      const res = await this.api.requestPasswordReset({
        username: this.username.trim(),
        reason: this.reason.trim(),
      });
      this.requestOk.set(res.message);
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
    const msgs = Object.entries(err.fieldErrors).map(([f, v]) => `${f}: ${(v as string[]).join(", ")}`);
    if (msgs.length) return msgs.join("; ");
  }
  if (Array.isArray(err?.formErrors) && err.formErrors.length) return err.formErrors.join(", ");
  return e?.message ?? "Failed";
}
