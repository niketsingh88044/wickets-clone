import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../services/auth.service";

declare const bootstrap: any;

@Component({
  selector: "app-change-password-modal",
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal fade" tabindex="-1" id="changePasswordModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header" style="background: var(--wk-green); color: #fff;">
            <h5 class="modal-title"><i class="fa fa-key me-2"></i>Change Password</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" (click)="reset()"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-info py-2 small">
              <i class="fa fa-info-circle"></i> Changing the password for
              <code>{{ auth.user()?.username }}</code> (<strong>{{ auth.role() }}</strong>).
              You'll stay logged in on this device after the change.
            </div>

            <form (ngSubmit)="submit()" autocomplete="off">
              <div class="mb-2">
                <label class="form-label small fw-bold">Current password <span class="text-danger">*</span></label>
                <input class="form-control form-control-sm" type="password" name="old"
                       [(ngModel)]="oldPassword" autocomplete="current-password" required>
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold">
                  New password <span class="text-danger">*</span>
                  <span class="float-end small"
                        [class.text-danger]="newPassword.length > 0 && newPassword.length < 6"
                        [class.text-success]="newPassword.length >= 6">
                    {{ newPassword.length }} / 6 min
                  </span>
                </label>
                <input class="form-control form-control-sm" type="password" name="new"
                       [(ngModel)]="newPassword" autocomplete="new-password" minlength="6" required
                       [class.is-invalid]="newPassword.length > 0 && newPassword.length < 6"
                       [class.is-valid]="newPassword.length >= 6">
              </div>

              <div class="mb-2">
                <label class="form-label small fw-bold">
                  Confirm new password <span class="text-danger">*</span>
                </label>
                <input class="form-control form-control-sm" type="password" name="confirm"
                       [(ngModel)]="confirmPassword" autocomplete="new-password" required
                       [class.is-invalid]="confirmPassword.length > 0 && confirmPassword !== newPassword"
                       [class.is-valid]="confirmPassword.length >= 6 && confirmPassword === newPassword">
                @if (confirmPassword.length > 0 && confirmPassword !== newPassword) {
                  <div class="form-text text-danger">Passwords don't match.</div>
                }
              </div>

              @if (error()) { <div class="alert alert-danger py-2 small">{{ error() }}</div> }
              @if (ok()) {
                <div class="alert alert-success py-2 small">
                  <i class="fa fa-check-circle"></i> Password updated successfully.
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
                <button type="submit" class="btn btn-success flex-grow-1"
                        [disabled]="busy() || blockers.length > 0 || ok()">
                  @if (busy()) {<span class="spinner-border spinner-border-sm me-2"></span>}
                  Update password
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ChangePasswordModalComponent {
  protected auth = inject(AuthService);
  private modal: any;

  oldPassword = "";
  newPassword = "";
  confirmPassword = "";
  busy = signal(false);
  error = signal<string | null>(null);
  ok = signal(false);

  get blockers(): string[] {
    const items: string[] = [];
    if (!this.oldPassword) items.push("Enter your current password");
    if (this.newPassword.length < 6) items.push(`New password: ${this.newPassword.length}/6 chars`);
    if (this.confirmPassword !== this.newPassword) items.push("Confirm password must match");
    if (this.oldPassword && this.newPassword && this.oldPassword === this.newPassword) {
      items.push("New password must be different from current");
    }
    return items;
  }

  show() {
    this.reset();
    const el = document.getElementById("changePasswordModal");
    if (!this.modal && el) this.modal = new bootstrap.Modal(el);
    this.modal?.show();
  }

  reset() {
    this.oldPassword = "";
    this.newPassword = "";
    this.confirmPassword = "";
    this.error.set(null);
    this.ok.set(false);
  }

  async submit() {
    if (this.blockers.length) return;
    this.busy.set(true);
    this.error.set(null);
    this.ok.set(false);
    try {
      await this.auth.changePassword(this.oldPassword, this.newPassword);
      this.ok.set(true);
      this.oldPassword = "";
      this.newPassword = "";
      this.confirmPassword = "";
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
