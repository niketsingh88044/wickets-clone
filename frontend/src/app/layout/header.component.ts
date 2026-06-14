import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { AuthService } from "../services/auth.service";
import { LoginModalComponent } from "../auth/login-modal.component";
import { ChangePasswordModalComponent } from "../auth/change-password-modal.component";
import { WithdrawModalComponent } from "../auth/withdraw-modal.component";

@Component({
  selector: "app-header",
  imports: [CommonModule, RouterLink, RouterLinkActive, LoginModalComponent, ChangePasswordModalComponent, WithdrawModalComponent],
  template: `
    <div class="top-bar">
      <div class="d-flex align-items-center gap-3">
        <a routerLink="/home" class="brand text-decoration-none">20<span style="color:#fff">W</span>ICKETS</a>
        <span class="badge bg-warning text-dark">PLAY MONEY</span>
      </div>

      <div class="d-flex align-items-center gap-2">
        @if (auth.isAuthed()) {
          @if (auth.role() === 'SUPER_MASTER') {
            <span class="badge bg-danger">SUPER MASTER</span>
          } @else if (auth.role() === 'MASTER') {
            <span class="badge bg-warning text-dark">MASTER</span>
          }
          <div class="wallet me-2">
            <div>Main <strong>PTI {{ auth.balance() | number:'1.2-2' }}</strong></div>
            <div>Exposure (<span [class.text-warning]="auth.exposure() > 0">{{ auth.exposure() | number:'1.0-0' }}</span>)</div>
          </div>
          <div class="dropdown">
            <button class="btn btn-sm btn-light dropdown-toggle" data-bs-toggle="dropdown">
              <i class="fa fa-user"></i> {{ auth.user()?.username }}
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              @if (auth.isAdmin()) {
                <li><a class="dropdown-item" routerLink="/admin"><i class="fa fa-crown me-2"></i>Admin Panel</a></li>
                <li><hr class="dropdown-divider"></li>
              }
              <li><a class="dropdown-item" routerLink="/myprofile"><i class="fa fa-id-card me-2"></i>My Profile</a></li>
              <li><a class="dropdown-item" routerLink="/bet-history"><i class="fa fa-history me-2"></i>Bet History</a></li>
              <li><hr class="dropdown-divider"></li>
              <li>
                <button class="dropdown-item" (click)="changePasswordModal.show()">
                  <i class="fa fa-key me-2"></i>Change Password
                </button>
              </li>
              @if (auth.user()?.parent) {
                <li>
                  <button class="dropdown-item" (click)="withdrawModal.show()">
                    <i class="fa fa-arrow-up me-2 text-warning"></i>Withdraw to {{ auth.user()?.parent?.username }}
                  </button>
                </li>
              }
              <li><button class="dropdown-item" (click)="auth.logout()"><i class="fa fa-sign-out-alt me-2"></i>Logout</button></li>
            </ul>
          </div>
        } @else {
          <button class="btn btn-sm btn-warning" (click)="loginModal.show()">
            <i class="fa fa-sign-in-alt"></i> Login
          </button>
        }
      </div>
    </div>

    <nav class="nav-bar">
      <a routerLink="/home" routerLinkActive="active">Home</a>
      <a routerLink="/home" routerLinkActive="active">In-Play</a>
      <a routerLink="/home" routerLinkActive="active">Cricket</a>
      @if (auth.isAdmin()) {
        <a routerLink="/search" routerLinkActive="active"><i class="fa fa-search me-1"></i>Search</a>
      }
      @for (tab of comingSoonTabs; track tab) {
        <a href="javascript:void(0)" class="disabled-tab" title="Coming soon — features to be defined">
          {{ tab }} <i class="fa fa-lock ms-1" style="font-size: 10px; opacity: 0.6;"></i>
        </a>
      }
      @if (auth.isAdmin()) {
        <a routerLink="/admin" routerLinkActive="active" class="ms-auto" style="background: rgba(255, 220, 31, 0.25);">
          <i class="fa fa-crown me-1"></i>Admin
        </a>
      }
    </nav>

    <app-login-modal #loginModal></app-login-modal>
    <app-change-password-modal #changePasswordModal></app-change-password-modal>
    <app-withdraw-modal #withdrawModal></app-withdraw-modal>
  `,
  styles: `
    .disabled-tab { opacity: 0.45; cursor: not-allowed !important; }
    .disabled-tab:hover { background: rgba(255,255,255,0.05) !important; }
  `,
})
export class HeaderComponent {
  auth = inject(AuthService);
  comingSoonTabs = ["Tennis", "Soccer", "Horse Racing", "Basketball", "Lottery", "Live Casino"];
}
