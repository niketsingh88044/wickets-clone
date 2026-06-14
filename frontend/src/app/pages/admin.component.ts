import { Component, effect, inject, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { CricbuzzLiveMatch, DownlineUser, ExternalSubscription, MatchSummary, ResetRequest, Role } from "../models";

declare const bootstrap: any;

@Component({
  selector: "app-admin",
  imports: [CommonModule, FormsModule],
  template: `
    @if (!auth.isAdmin()) {
      <div class="alert alert-danger">
        <i class="fa fa-ban"></i> You don't have admin access. This page is for masters and super-master only.
      </div>
    } @else {
      <div class="market-card">
        <div class="market-head">
          <span><i class="fa fa-crown me-2"></i>Admin Panel — {{ auth.role() }}</span>
          @if (auth.role() === 'SUPER_MASTER') {
            <button class="btn btn-sm btn-outline-light ms-3" (click)="regenerateFixtures()" [disabled]="regenerating()">
              @if (regenerating()) { <span class="spinner-border spinner-border-sm me-1"></span> }
              <i class="fa fa-refresh me-1"></i>Regenerate match slate
            </button>
          }
          <span class="small ms-auto">Your balance: <strong>{{ auth.balance() | number:'1.0-2' }} PTI</strong></span>
        </div>
        @if (regenMsg()) {
          <div class="alert alert-success py-1 small mb-0">{{ regenMsg() }}</div>
        }
      </div>

      <!-- Live match subscriptions (super-master only) -->
      @if (auth.role() === 'SUPER_MASTER') {
        <div class="market-card mt-2">
          <div class="market-head" style="background: #b02a37">
            <i class="fa fa-broadcast-tower me-2"></i>Live Match Subscriptions (India Today)
            <button class="btn btn-sm btn-outline-light ms-auto" (click)="refreshExternal()" [disabled]="extLoading()">
              <i class="fa fa-refresh"></i> Refresh
            </button>
          </div>

          <div class="p-3">
            <div class="alert alert-secondary py-2 small mb-2">
              <i class="fa fa-info-circle"></i>
              Visit <a href="https://www.indiatoday.in/live-score/cricket" target="_blank" rel="noopener">indiatoday.in/live-score/cricket</a>,
              open any <strong>currently live</strong> match, and paste either the full URL
              or just the numeric ID at the end (e.g. <code>271343</code>) below.
              Data is polled every 30 seconds. The endpoint stops returning data once the match ends.
            </div>

            <form (ngSubmit)="addExternal()" class="d-flex gap-2">
              <input class="form-control form-control-sm" type="text" name="ext"
                     [(ngModel)]="extInput"
                     placeholder="271343  OR  https://www.indiatoday.in/live-score/cricket/oman-...-271343"
                     required>
              <button class="btn btn-sm btn-danger" type="submit" [disabled]="extBusy() || !extInput.trim()">
                @if (extBusy()) { <span class="spinner-border spinner-border-sm me-1"></span> }
                Add
              </button>
            </form>
            @if (extError()) { <div class="alert alert-danger py-1 small mt-2 mb-0">{{ extError() }}</div> }
            @if (extOk()) { <div class="alert alert-success py-1 small mt-2 mb-0">{{ extOk() }}</div> }

            @if (extSubs().subscriptions.length === 0) {
              <div class="text-muted small mt-3"><em>No subscriptions yet.</em></div>
            } @else {
              <div class="table-responsive mt-3">
                <table class="table table-sm mb-0">
                  <thead class="table-light">
                    <tr><th>External ID</th><th>Match</th><th>Live</th><th></th></tr>
                  </thead>
                  <tbody>
                    @for (id of extSubs().subscriptions; track id) {
                      @let m = matchForExternalId(id);
                      <tr>
                        <td><code>{{ id }}</code></td>
                        <td>
                          @if (m) { {{ m.name }} }
                          @else { <span class="text-muted"><em>not ingested yet — match may have ended</em></span> }
                        </td>
                        <td>
                          @if (m?.inPlay) {
                            <span class="badge bg-success"><i class="fa fa-circle me-1" style="font-size:7px"></i>LIVE</span>
                          } @else if (m) {
                            <span class="badge bg-secondary">FINISHED</span>
                          } @else { — }
                        </td>
                        <td><button class="btn btn-sm btn-outline-danger" (click)="removeExternal(id)">Remove</button></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      }

      <!-- Live cricket scorecards (Cricbuzz) — admin-only API calls -->
      <div class="market-card mt-2">
        <div class="market-head" style="background: #0d6efd">
          <i class="fa fa-baseball-ball me-2"></i>Live Cricket Scorecards (Cricbuzz)
          <span class="badge bg-warning text-dark ms-2">admin only</span>
          <button class="btn btn-sm btn-outline-light ms-3" (click)="loadCricbuzzLive()" [disabled]="cbLiveLoading()">
            @if (cbLiveLoading()) { <span class="spinner-border spinner-border-sm me-1"></span> }
            <i class="fa fa-broadcast-tower me-1"></i> Fetch live list
          </button>
          <button class="btn btn-sm btn-warning ms-2" (click)="refreshAllScorecards()" [disabled]="cbRefreshAllBusy()">
            @if (cbRefreshAllBusy()) { <span class="spinner-border spinner-border-sm me-1"></span> }
            <i class="fa fa-refresh me-1"></i> Refresh all linked
          </button>
          <button class="btn btn-sm btn-outline-light ms-2" (click)="loadAppMatches()" [disabled]="cbMatchesLoading()">
            <i class="fa fa-list"></i> Reload matches
          </button>
        </div>

        <div class="p-3">
          <div class="alert alert-secondary py-2 small mb-2">
            <i class="fa fa-info-circle"></i>
            Only admins can call the RapidAPI cricbuzz endpoint — regular users see the cached scorecard
            from the last refresh. Click <strong>Fetch live list</strong> to discover live cricbuzz match IDs,
            paste one into a match's row to <strong>Link</strong>, then press <strong>Refresh</strong>.
          </div>

          @if (cbError()) { <div class="alert alert-danger py-1 small mb-2">{{ cbError() }}</div> }
          @if (cbOk()) { <div class="alert alert-success py-1 small mb-2">{{ cbOk() }}</div> }

          <form (ngSubmit)="subscribeByPastedId()" class="d-flex gap-2 mb-2">
            <input class="form-control form-control-sm" type="number" name="newCbId"
                   [(ngModel)]="newCbId"
                   placeholder="Paste a cricbuzz match ID to subscribe (e.g. 160172)"
                   style="max-width: 360px;">
            <button class="btn btn-sm btn-success" type="submit"
                    [disabled]="!newCbId || cbSubscribingId() === newCbId">
              @if (cbSubscribingId() === newCbId) { <span class="spinner-border spinner-border-sm me-1"></span> }
              <i class="fa fa-plus me-1"></i> Subscribe by ID
            </button>
          </form>

          @if (cbLiveMatches().length > 0) {
            <details open class="mb-2">
              <summary class="small">
                <i class="fa fa-circle text-danger me-1" style="font-size:8px"></i>
                <strong>{{ cbLiveMatches().length }}</strong> live matches on Cricbuzz right now
              </summary>
              <div class="table-responsive mt-2" style="max-height:300px; overflow-y:auto;">
                <table class="table table-sm mb-0">
                  <thead class="table-light sticky-top">
                    <tr>
                      <th>cricbuzz ID</th>
                      <th>Match</th>
                      <th>Format</th>
                      <th>Started</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of cbLiveMatches(); track m.matchId) {
                      <tr>
                        <td><code class="user-select-all">{{ m.matchId }}</code></td>
                        <td>{{ m.team1Short }} v {{ m.team2Short }}<br><small class="text-muted">{{ m.seriesName }}</small></td>
                        <td><span class="badge bg-secondary">{{ m.matchFormat }}</span></td>
                        <td><small>{{ asMs(m.startDate) | date:'short' }}</small></td>
                        <td><small>{{ m.status }}</small></td>
                        <td>
                          <button class="btn btn-sm btn-success"
                                  (click)="subscribeFromLive(m.matchId)"
                                  [disabled]="cbSubscribingId() === m.matchId">
                            @if (cbSubscribingId() === m.matchId) {
                              <span class="spinner-border spinner-border-sm me-1"></span>
                            } @else {
                              <i class="fa fa-plus me-1"></i>
                            }
                            Subscribe
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          }

          @if (cbUpcomingMatches().length > 0) {
            <details class="mb-2">
              <summary class="small">
                <i class="fa fa-clock text-primary me-1"></i>
                <strong>{{ cbUpcomingMatches().length }}</strong> upcoming matches on Cricbuzz
                <span class="text-muted">(click to expand)</span>
              </summary>
              <div class="table-responsive mt-2" style="max-height:300px; overflow-y:auto;">
                <table class="table table-sm mb-0">
                  <thead class="table-light sticky-top">
                    <tr>
                      <th>cricbuzz ID</th>
                      <th>Match</th>
                      <th>Format</th>
                      <th>Starts</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of cbUpcomingMatches(); track m.matchId) {
                      <tr>
                        <td><code class="user-select-all">{{ m.matchId }}</code></td>
                        <td>{{ m.team1Short }} v {{ m.team2Short }}<br><small class="text-muted">{{ m.seriesName }}</small></td>
                        <td><span class="badge bg-secondary">{{ m.matchFormat }}</span></td>
                        <td>
                          <small>{{ asMs(m.startDate) | date:'short' }}</small>
                          <br><small class="text-muted">{{ relativeTime(m.startDate) }}</small>
                        </td>
                        <td><small>{{ m.status }}</small></td>
                        <td>
                          <button class="btn btn-sm btn-success"
                                  (click)="subscribeFromLive(m.matchId)"
                                  [disabled]="cbSubscribingId() === m.matchId">
                            @if (cbSubscribingId() === m.matchId) {
                              <span class="spinner-border spinner-border-sm me-1"></span>
                            } @else {
                              <i class="fa fa-plus me-1"></i>
                            }
                            Subscribe
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          }

          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr>
                  <th>App match</th>
                  <th style="width: 200px;">Cricbuzz match ID</th>
                  <th>Last summary</th>
                  <th>Updated</th>
                  <th style="width: 220px;"></th>
                </tr>
              </thead>
              <tbody>
                @for (m of appMatches(); track m.id) {
                  <tr>
                    <td>
                      {{ m.name }}
                      @if (m.inPlay) { <span class="badge bg-success ms-1">LIVE</span> }
                    </td>
                    <td>
                      <input class="form-control form-control-sm" type="number"
                             [(ngModel)]="cricIdInputs[m.id]" name="cb_{{ m.id }}"
                             placeholder="e.g. 40381">
                      @if (suggestFor(m); as s) {
                        <div class="small mt-1">
                          <i class="fa fa-lightbulb text-warning"></i>
                          <button type="button" class="btn btn-link btn-sm p-0 align-baseline"
                                  (click)="useSuggestion(m, s)"
                                  title="Click to auto-link to this cricbuzz match">
                            #{{ s.cricbuzzId }} {{ s.label }}
                          </button>
                          <span class="text-muted">({{ (s.score * 100).toFixed(0) }}% match)</span>
                        </div>
                      }
                    </td>
                    <td>
                      @if (m.liveSummary) {
                        <small><strong>{{ m.liveSummary }}</strong></small>
                        @if (m.liveStatus) { <br><small class="text-muted">{{ m.liveStatus }}</small> }
                      } @else {
                        <small class="text-muted"><em>not refreshed</em></small>
                      }
                    </td>
                    <td>
                      @if (m.liveScoreUpdatedAt) {
                        <small>{{ m.liveScoreUpdatedAt | date:'shortTime' }}</small>
                      } @else { — }
                    </td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-outline-primary me-1"
                              (click)="linkScorecard(m)"
                              [disabled]="cbBusyId() === m.id">
                        Link
                      </button>
                      <button class="btn btn-sm btn-primary me-1"
                              (click)="refreshScorecard(m)"
                              [disabled]="!m.cricbuzzMatchId || cbBusyId() === m.id">
                        @if (cbBusyId() === m.id) { <span class="spinner-border spinner-border-sm me-1"></span> }
                        Refresh
                      </button>
                      <button class="btn btn-sm btn-outline-danger"
                              (click)="confirmDeleteMatch(m)"
                              [disabled]="cbBusyId() === m.id"
                              title="Delete this match (refunds any open bets first)">
                        <i class="fa fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="text-center text-muted small py-3">No matches loaded. Click "Reload matches".</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Pending reset requests -->
      <div class="market-card mt-2" [class.border-warning]="requests().length > 0">
        <div class="market-head" [style.background]="requests().length > 0 ? '#c97a00' : null">
          <span>
            <i class="fa fa-key me-2"></i>Pending Password Reset Requests
            <span class="badge bg-warning text-dark ms-2">{{ requests().length }}</span>
          </span>
          @if (auth.role() === 'SUPER_MASTER') {
            <div class="btn-group btn-group-sm ms-3" role="group">
              <button class="btn" [class.btn-warning]="reqScope() === 'direct'" [class.btn-outline-light]="reqScope() !== 'direct'" (click)="setReqScope('direct')">Direct</button>
              <button class="btn" [class.btn-warning]="reqScope() === 'tree'" [class.btn-outline-light]="reqScope() !== 'tree'" (click)="setReqScope('tree')">Whole tree</button>
            </div>
          }
          <button class="btn btn-sm btn-outline-light ms-auto" (click)="refresh()">
            <i class="fa fa-refresh"></i> Refresh
          </button>
        </div>

        @if (requests().length === 0) {
          <div class="p-3 text-center text-muted small">
            No pending requests. Users initiate resets from the "Forgot password?" link on the login modal.
          </div>
        } @else {
          <div class="alert alert-warning small m-2 mb-0">
            <i class="fa fa-shield-alt"></i>
            <strong>Verify each request out-of-band</strong> (WhatsApp or phone) before approving.
            You are accountable for resets you approve — they are logged with your username and your verification note.
          </div>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr>
                  <th>Requested at</th><th>Username</th><th>Role</th>
                  @if (reqScope() === 'tree') { <th>Under</th> }
                  <th>User's reason</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (r of requests(); track r.id) {
                  <tr>
                    <td><small>{{ r.createdAt | date:'short' }}</small></td>
                    <td><code>{{ r.user.username }}</code></td>
                    <td><span class="badge" [class.bg-info]="r.user.role === 'USER'" [class.bg-warning]="r.user.role === 'MASTER'">{{ r.user.role }}</span></td>
                    @if (reqScope() === 'tree') {
                      <td>
                        @if (r.user.parent) {
                          <small><code>{{ r.user.parent.username }}</code></small>
                        } @else { <small class="text-muted">—</small> }
                      </td>
                    }
                    <td><small><em>{{ r.reason }}</em></small></td>
                    <td>
                      <button class="btn btn-sm btn-success me-1" (click)="openApprove(r)">
                        <i class="fa fa-check"></i> Approve
                      </button>
                      <button class="btn btn-sm btn-outline-danger" (click)="openReject(r)">
                        <i class="fa fa-times"></i> Reject
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="row g-2 mt-2">
        <!-- Create account -->
        <div class="col-md-5">
          <div class="market-card">
            <div class="market-head"><i class="fa fa-user-plus me-2"></i>Create Account</div>
            <div class="p-3">
              <form (ngSubmit)="onCreate()">
                <div class="mb-2">
                  <label class="form-label small">Role</label>
                  <select class="form-select form-select-sm" [(ngModel)]="newRole" name="role">
                    <option value="USER">USER (bettor)</option>
                    @if (auth.role() === 'SUPER_MASTER') {
                      <option value="MASTER">MASTER (sub-agent)</option>
                    }
                  </select>
                </div>
                <div class="mb-2">
                  <label class="form-label small">Username</label>
                  <input class="form-control form-control-sm" type="text" [(ngModel)]="newUsername" name="username" required>
                </div>
                <div class="mb-2">
                  <label class="form-label small">Password</label>
                  <input class="form-control form-control-sm" type="text" [(ngModel)]="newPassword" name="password" required>
                  <div class="form-text">Share with them via your verified channel.</div>
                </div>
                @if (createError()) { <div class="alert alert-danger py-1 small">{{ createError() }}</div> }
                @if (createOk()) {
                  <div class="alert alert-success py-1 small">
                    Created <strong>{{ createOk() }}</strong>.
                  </div>
                }
                <button class="btn btn-success btn-sm w-100" [disabled]="busy()">Create</button>
              </form>
            </div>
          </div>
        </div>

        <!-- Credit/debit -->
        <div class="col-md-7">
          <div class="market-card">
            <div class="market-head">
              <i class="fa fa-coins me-2"></i>Credit / Debit Chips
              @if (auth.role() === 'SUPER_MASTER') {
                <span class="badge bg-warning text-dark ms-2">unlimited mint</span>
              } @else {
                <span class="small ms-2">your pool: <strong>{{ auth.balance() | number:'1.0-0' }}</strong></span>
              }
            </div>
            <div class="p-3">
              <form (ngSubmit)="onCredit()">
                <div class="mb-2">
                  <label class="form-label small">Target user</label>
                  <select class="form-select form-select-sm" [(ngModel)]="creditTargetId" name="t" required>
                    <option [ngValue]="null">Select from your downline…</option>
                    @for (u of children(); track u.id) {
                      <option [ngValue]="u.id">{{ u.username }} ({{ u.role }}) — bal {{ u.wallet?.balance | number }}</option>
                    }
                  </select>
                </div>
                <div class="row g-2">
                  <div class="col-6">
                    <label class="form-label small">Amount (negative = debit)</label>
                    <input class="form-control form-control-sm" type="number" [(ngModel)]="creditAmount" name="a" required>
                  </div>
                  <div class="col-6">
                    <label class="form-label small">Note (optional)</label>
                    <input class="form-control form-control-sm" type="text" [(ngModel)]="creditNote" name="n" maxlength="200">
                  </div>
                </div>
                <div class="quick-stake mt-2">
                  @for (q of [100, 500, 1000, 5000, 10000, 50000]; track q) {
                    <button type="button" class="btn btn-outline-secondary btn-sm" (click)="creditAmount = q">+{{ q }}</button>
                  }
                </div>
                @if (creditError()) { <div class="alert alert-danger py-1 small">{{ creditError() }}</div> }
                @if (creditOk()) { <div class="alert alert-success py-1 small">{{ creditOk() }}</div> }
                <button class="btn btn-warning btn-sm w-100 mt-2" [disabled]="busy() || !creditTargetId || !creditAmount">
                  Apply
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <!-- Downline list -->
      <div class="market-card mt-2">
        <div class="market-head">
          <i class="fa fa-sitemap me-2"></i>
          @if (scope() === 'tree') { All Accounts ({{ children().length }}) }
          @else { My Downline ({{ children().length }}) }
          @if (auth.role() === 'SUPER_MASTER') {
            <div class="btn-group btn-group-sm ms-3" role="group">
              <button class="btn" [class.btn-warning]="scope() === 'direct'" [class.btn-outline-light]="scope() !== 'direct'" (click)="setScope('direct')">My direct children</button>
              <button class="btn" [class.btn-warning]="scope() === 'tree'" [class.btn-outline-light]="scope() !== 'tree'" (click)="setScope('tree')">Whole tree</button>
            </div>
          }
          <button class="btn btn-sm btn-outline-light ms-auto" (click)="refresh()">
            <i class="fa fa-refresh"></i> Refresh
          </button>
        </div>
        <div class="px-3 py-2" style="font-size: 12px; background:#f8f9fa; border-bottom:1px solid #eee;">
          <i class="fa fa-info-circle text-info"></i>
          <strong>Password resets:</strong> admins cannot reset passwords on demand anymore.
          Users must request a reset from the login screen first; then approve here.
        </div>
        @if (children().length === 0) {
          <div class="p-3 text-center text-muted">No accounts yet. Use the "Create Account" form above.</div>
        } @else {
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr>
                  <th>Username</th><th>Role</th>
                  @if (scope() === 'tree') { <th>Under</th> }
                  <th class="text-end">Balance</th><th class="text-end">Exposure</th>
                  <th class="text-end">Bets</th><th class="text-end">Sub-accounts</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                @for (u of children(); track u.id) {
                  <tr>
                    <td><code>{{ u.username }}</code></td>
                    <td><span class="badge" [class.bg-info]="u.role === 'USER'" [class.bg-warning]="u.role === 'MASTER'">{{ u.role }}</span></td>
                    @if (scope() === 'tree') {
                      <td>
                        @if (u.parent) {
                          <small><code>{{ u.parent.username }}</code> <span class="text-muted">({{ u.parent.role }})</span></small>
                        } @else { <small class="text-muted">—</small> }
                      </td>
                    }
                    <td class="text-end">{{ u.wallet?.balance | number:'1.0-2' }}</td>
                    <td class="text-end text-warning">{{ u.wallet?.exposure | number }}</td>
                    <td class="text-end">{{ u._count.bets }}</td>
                    <td class="text-end">{{ u._count.children }}</td>
                    <td><small>{{ u.createdAt | date:'short' }}</small></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Approve modal -->
      <div class="modal fade" tabindex="-1" id="approveResetModal">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header" style="background: #1d8a3b; color: #fff;">
              <h5 class="modal-title">
                <i class="fa fa-check-circle me-2"></i>Approve reset for
                @if (activeRequest()) { <code class="text-warning bg-dark px-2 py-1 ms-1 rounded">{{ activeRequest()!.user.username }}</code> }
              </h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" (click)="closeApprove()"></button>
            </div>
            <div class="modal-body">
              @if (activeRequest()) {
                <div class="alert alert-info py-2 small">
                  <strong>User's stated reason:</strong> <em>{{ activeRequest()!.reason }}</em><br>
                  <strong>Requested:</strong> {{ activeRequest()!.createdAt | date:'medium' }}
                </div>
                <div class="alert alert-warning py-2 small">
                  <i class="fa fa-shield-alt"></i>
                  <strong>Before approving:</strong> contact the user via WhatsApp / phone and confirm
                  they really requested this. A master can theoretically file a fake request to steal chips —
                  your verification is the only thing stopping that.
                </div>

                <form (ngSubmit)="confirmApprove()">
                  <div class="mb-2">
                    <label class="form-label small fw-bold">
                      How did you verify? <span class="text-danger">*</span>
                      <span class="float-end small"
                            [class.text-danger]="approveNote.length < 15"
                            [class.text-success]="approveNote.length >= 15">
                        {{ approveNote.length }} / 15 min
                      </span>
                    </label>
                    <textarea class="form-control form-control-sm" rows="2" name="note"
                              [(ngModel)]="approveNote"
                              [class.is-invalid]="approveNote.length > 0 && approveNote.length < 15"
                              [class.is-valid]="approveNote.length >= 15"
                              placeholder="e.g. WhatsApp call from +91 98xxx-xx1234, confirmed signup date and last bet"
                              minlength="15" maxlength="500" required></textarea>
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-bold">
                      New password <span class="text-danger">*</span>
                      <span class="float-end small"
                            [class.text-danger]="approvePassword.length > 0 && approvePassword.length < 6"
                            [class.text-success]="approvePassword.length >= 6">
                        {{ approvePassword.length }} / 6 min
                      </span>
                    </label>
                    <div class="input-group input-group-sm">
                      <input class="form-control" type="text" [(ngModel)]="approvePassword" name="pw"
                             [class.is-invalid]="approvePassword.length > 0 && approvePassword.length < 6"
                             [class.is-valid]="approvePassword.length >= 6"
                             minlength="6" required>
                      <button type="button" class="btn btn-outline-secondary" (click)="randomPassword()">
                        <i class="fa fa-dice"></i> Random
                      </button>
                    </div>
                  </div>
                  <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" id="attestCheck"
                           [(ngModel)]="approveAttest" name="attest">
                    <label class="form-check-label small" for="attestCheck">
                      <strong>I have verified</strong> this request is from the legitimate owner of
                      <code>{{ activeRequest()!.user.username }}</code> and accept responsibility.
                    </label>
                  </div>

                  @if (approveError()) { <div class="alert alert-danger py-1 small">{{ approveError() }}</div> }
                  @if (approveOk()) {
                    <div class="alert alert-success py-2 small">
                      <i class="fa fa-check-circle"></i> Password reset. Share via the verified channel:
                      <div class="mt-2">
                        <code class="bg-dark text-warning px-2 py-1 rounded">{{ approvePassword }}</code>
                        <button type="button" class="btn btn-sm btn-outline-secondary ms-2" (click)="copyPassword()">
                          <i class="fa fa-copy"></i> Copy
                        </button>
                      </div>
                    </div>
                  }

                  @if (!approveOk() && approveBlockers.length > 0) {
                    <div class="alert alert-warning py-2 small mb-2">
                      <i class="fa fa-info-circle"></i> Still needed before approval:
                      <ul class="mb-0 mt-1">
                        @for (b of approveBlockers; track b) { <li>{{ b }}</li> }
                      </ul>
                    </div>
                  }

                  <div class="d-flex gap-2 mt-2">
                    <button type="button" class="btn btn-secondary flex-grow-1" data-bs-dismiss="modal" (click)="closeApprove()">Cancel</button>
                    <button type="submit" class="btn btn-success flex-grow-1"
                            [disabled]="busy() || approveBlockers.length > 0 || approveOk()">
                      @if (busy()) {<span class="spinner-border spinner-border-sm me-2"></span>}
                      Confirm approval
                    </button>
                  </div>
                </form>
              }
            </div>
          </div>
        </div>
      </div>

      <!-- Reject modal -->
      <div class="modal fade" tabindex="-1" id="rejectResetModal">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header" style="background: #b02a37; color: #fff;">
              <h5 class="modal-title">
                <i class="fa fa-times-circle me-2"></i>Reject reset request
              </h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" (click)="closeReject()"></button>
            </div>
            <div class="modal-body">
              @if (activeRequest()) {
                <p class="small">Rejecting reset for <code>{{ activeRequest()!.user.username }}</code>.</p>
                <form (ngSubmit)="confirmReject()">
                  <div class="mb-2">
                    <label class="form-label small fw-bold">Reason for rejection</label>
                    <textarea class="form-control form-control-sm" rows="2" [(ngModel)]="rejectReason" name="r"
                              minlength="5" maxlength="300" required
                              placeholder="e.g. could not reach user, identity not verified"></textarea>
                  </div>
                  @if (rejectError()) { <div class="alert alert-danger py-1 small">{{ rejectError() }}</div> }
                  <div class="d-flex gap-2">
                    <button type="button" class="btn btn-secondary flex-grow-1" data-bs-dismiss="modal" (click)="closeReject()">Cancel</button>
                    <button type="submit" class="btn btn-danger flex-grow-1" [disabled]="busy() || rejectReason.length < 5">Confirm rejection</button>
                  </div>
                </form>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);

  children = signal<DownlineUser[]>([]);
  requests = signal<ResetRequest[]>([]);
  scope = signal<"direct" | "tree">("direct");
  reqScope = signal<"direct" | "tree">("direct");
  busy = signal(false);

  newUsername = "";
  newPassword = "";
  newRole: Role = "USER";
  createError = signal<string | null>(null);
  createOk = signal<string | null>(null);

  creditTargetId: string | null = null;
  creditAmount = 0;
  creditNote = "";
  creditError = signal<string | null>(null);
  creditOk = signal<string | null>(null);

  // Approve/Reject modal state
  activeRequest = signal<ResetRequest | null>(null);
  approvePassword = "";
  approveNote = "";
  approveAttest = false;
  approveError = signal<string | null>(null);
  approveOk = signal(false);

  // Getter so it re-runs on every change-detection cycle (ngModel
  // binds to plain properties, not signals, so computed() wouldn't react).
  get approveBlockers(): string[] {
    const items: string[] = [];
    if (this.approveNote.length < 15) items.push(`Verification note: ${this.approveNote.length}/15 chars`);
    if (this.approvePassword.length < 6) items.push(`New password: ${this.approvePassword.length}/6 chars`);
    if (!this.approveAttest) items.push(`Tick the "I have verified" checkbox`);
    return items;
  }
  rejectReason = "";
  rejectError = signal<string | null>(null);

  regenerating = signal(false);
  regenMsg = signal<string | null>(null);

  // External (India Today) subscriptions
  extSubs = signal<ExternalSubscription>({ subscriptions: [], matches: [] });
  extInput = "";
  extBusy = signal(false);
  extLoading = signal(false);
  extError = signal<string | null>(null);
  extOk = signal<string | null>(null);

  // Cricbuzz scorecards
  appMatches = signal<(MatchSummary & {
    cricbuzzMatchId?: number | null;
    liveSummary?: string | null;
    liveStatus?: string | null;
    liveScoreUpdatedAt?: string | null;
  })[]>([]);
  cbLiveMatches = signal<CricbuzzLiveMatch[]>([]);
  cbUpcomingMatches = signal<CricbuzzLiveMatch[]>([]);
  cricIdInputs: Record<string, number | null> = {};
  cbMatchesLoading = signal(false);
  cbLiveLoading = signal(false);
  cbRefreshAllBusy = signal(false);
  cbBusyId = signal<string | null>(null);
  cbSubscribingId = signal<number | null>(null);
  newCbId: number | null = null;
  cbError = signal<string | null>(null);
  cbOk = signal<string | null>(null);

  matchForExternalId(id: string) {
    return this.extSubs().matches.find(m => m.externalId === id);
  }
  private approveModal: any;
  private rejectModal: any;

  constructor() {
    effect(() => {
      if (this.auth.isAdmin()) this.refresh();
    });
  }

  async ngOnInit() {
    if (this.auth.isAdmin()) await this.refresh();
  }

  async refresh() {
    try {
      const [downline, reqs] = await Promise.all([
        this.api.downline(this.scope()),
        this.api.listResetRequests(this.reqScope()),
      ]);
      this.children.set(downline);
      this.requests.set(reqs);
      await this.auth.refreshBalance();
      if (this.auth.role() === "SUPER_MASTER") await this.refreshExternal();
      await this.loadAppMatches();
    } catch {}
  }

  async loadAppMatches() {
    this.cbMatchesLoading.set(true);
    try {
      const matches = await this.api.listMatches();
      this.appMatches.set(matches as any);
      for (const m of matches as any[]) {
        if (m.cricbuzzMatchId != null && this.cricIdInputs[m.id] == null) {
          this.cricIdInputs[m.id] = m.cricbuzzMatchId;
        }
      }
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbMatchesLoading.set(false);
    }
  }

  async loadCricbuzzLive() {
    this.cbLiveLoading.set(true);
    this.cbError.set(null);
    try {
      const r = await this.api.cricbuzzList();
      this.cbLiveMatches.set(r.live);
      this.cbUpcomingMatches.set(r.upcoming);
      this.cbOk.set(`Fetched ${r.live.length} live + ${r.upcoming.length} upcoming match(es) from Cricbuzz.`);
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbLiveLoading.set(false);
    }
  }

  async linkScorecard(m: { id: string; name: string }) {
    const id = this.cricIdInputs[m.id];
    this.cbBusyId.set(m.id);
    this.cbError.set(null);
    this.cbOk.set(null);
    try {
      await this.api.linkCricbuzz(m.id, id == null ? null : Number(id));
      this.cbOk.set(`${m.name}: linked to cricbuzz ID ${id ?? "—"}`);
      await this.loadAppMatches();
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbBusyId.set(null);
    }
  }

  async refreshScorecard(m: { id: string; name: string }) {
    this.cbBusyId.set(m.id);
    this.cbError.set(null);
    this.cbOk.set(null);
    try {
      const r = await this.api.refreshCricbuzz(m.id);
      this.cbOk.set(`${m.name}: ${r.match?.liveSummary ?? "refreshed"}`);
      await this.loadAppMatches();
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbBusyId.set(null);
    }
  }

  // startDate from cricbuzz comes as an epoch-ms string; the date pipe needs a
  // number or Date, so coerce here. Returns null when missing so the template
  // doesn't print "Invalid Date".
  asMs(s: string | number | null | undefined): number | null {
    if (s == null || s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // "in 2h 35m" / "1d 4h ago". Cheap, no library.
  relativeTime(s: string | number | null | undefined): string {
    const ms = this.asMs(s);
    if (ms == null) return "";
    let diff = ms - Date.now();
    const future = diff > 0;
    diff = Math.abs(diff);
    const m = Math.floor(diff / 60_000);
    if (m < 1) return future ? "starting now" : "just now";
    if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return future ? `in ${h}h ${m % 60}m` : `${h}h ${m % 60}m ago`;
    const d = Math.floor(h / 24);
    return future ? `in ${d}d ${h % 24}h` : `${d}d ${h % 24}h ago`;
  }

  async confirmDeleteMatch(m: { id: string; name: string }) {
    const ok = window.confirm(
      `Delete "${m.name}"?\n\n` +
      `This removes the match, its markets, runners, and any bets attached to it. ` +
      `Open bets get refunded (liability returned to balance, exposure dropped).`
    );
    if (!ok) return;
    this.cbBusyId.set(m.id);
    this.cbError.set(null);
    this.cbOk.set(null);
    try {
      const r = await this.api.deleteMatch(m.id);
      let msg = `Deleted "${r.name}".`;
      if (r.refundedBets > 0) msg += ` Refunded ${r.refundedBets} open bet(s) to ${r.refundedUsers} user(s).`;
      this.cbOk.set(msg);
      await this.loadAppMatches();
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbBusyId.set(null);
    }
  }

  async subscribeFromLive(cricbuzzMatchId: number) {
    await this.runSubscribe(cricbuzzMatchId);
  }

  async subscribeByPastedId() {
    const id = Number(this.newCbId);
    if (!Number.isFinite(id) || id <= 0) return;
    await this.runSubscribe(id);
    if (this.cbError() == null) this.newCbId = null;
  }

  private async runSubscribe(cricbuzzMatchId: number) {
    this.cbSubscribingId.set(cricbuzzMatchId);
    this.cbError.set(null);
    this.cbOk.set(null);
    try {
      const r = await this.api.subscribeCricbuzz(cricbuzzMatchId);
      if (r.alreadySubscribed) {
        this.cbOk.set(`Already subscribed: ${r.match?.name} — refreshed.`);
      } else {
        this.cbOk.set(`Subscribed: ${r.match?.name}`);
      }
      await this.loadAppMatches();
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbSubscribingId.set(null);
    }
  }

  // ---- Auto-match: client-side fuzzy match of app match name against the
  // live cricbuzz list. Called from the template once per row; cheap (linear
  // scan over <=20 live matches), no extra API calls.
  suggestFor(appMatch: { id: string; name: string }): { cricbuzzId: number; score: number; label: string } | null {
    const tokens = tokenizeMatchName(appMatch.name);
    if (tokens.length === 0) return null;
    const live = this.cbLiveMatches();
    if (live.length === 0) return null;

    let best: CricbuzzLiveMatch | null = null;
    let bestScore = 0;
    for (const c of live) {
      const s = scoreCricbuzzMatch(tokens, c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    // Require every token from the app name to land in the cricbuzz team
    // strings — partial matches like "Pakistan v Australia" -> "AUS v BAN"
    // (only "Australia" hits) are too noisy to surface as a suggestion.
    if (!best || bestScore < 0.999) return null;
    return {
      cricbuzzId: best.matchId,
      score: bestScore,
      label: `${best.team1Short ?? best.team1} v ${best.team2Short ?? best.team2} (${best.matchFormat ?? "?"})`,
    };
  }

  async useSuggestion(m: { id: string; name: string }, s: { cricbuzzId: number }) {
    this.cricIdInputs[m.id] = s.cricbuzzId;
    await this.linkScorecard(m);
    // Chain a refresh so one click both saves the binding and pulls the scorecard.
    if (this.cbError() == null) await this.refreshScorecard(m);
  }

  async refreshAllScorecards() {
    this.cbRefreshAllBusy.set(true);
    this.cbError.set(null);
    this.cbOk.set(null);
    try {
      const r = await this.api.refreshCricbuzzAll();
      const okCount = r.results.filter(x => x.ok).length;
      this.cbOk.set(`Refreshed ${okCount}/${r.refreshed} linked matches.`);
      await this.loadAppMatches();
    } catch (e: any) {
      this.cbError.set(extractError(e));
    } finally {
      this.cbRefreshAllBusy.set(false);
    }
  }

  setScope(s: "direct" | "tree") { this.scope.set(s); this.refresh(); }
  setReqScope(s: "direct" | "tree") { this.reqScope.set(s); this.refresh(); }

  // ----- Approve -----
  openApprove(r: ResetRequest) {
    this.activeRequest.set(r);
    this.approvePassword = "";
    this.approveNote = "";
    this.approveAttest = false;
    this.approveError.set(null);
    this.approveOk.set(false);
    setTimeout(() => {
      const el = document.getElementById("approveResetModal");
      if (!this.approveModal && el) this.approveModal = new bootstrap.Modal(el);
      this.approveModal?.show();
    }, 0);
  }
  closeApprove() {
    this.approveModal?.hide();
    if (this.approveOk()) this.refresh();
    this.activeRequest.set(null);
  }
  randomPassword() {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pw = "";
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    this.approvePassword = pw;
  }
  async copyPassword() {
    try { await navigator.clipboard.writeText(this.approvePassword); } catch {}
  }
  async confirmApprove() {
    const r = this.activeRequest();
    if (!r || !this.approveAttest) return;
    this.busy.set(true);
    this.approveError.set(null);
    this.approveOk.set(false);
    try {
      await this.api.approveResetRequest(r.id, {
        newPassword: this.approvePassword,
        verificationNote: this.approveNote,
        attestVerified: true,
      });
      this.approveOk.set(true);
    } catch (e: any) {
      this.approveError.set(extractError(e));
    } finally {
      this.busy.set(false);
    }
  }

  // ----- Reject -----
  openReject(r: ResetRequest) {
    this.activeRequest.set(r);
    this.rejectReason = "";
    this.rejectError.set(null);
    setTimeout(() => {
      const el = document.getElementById("rejectResetModal");
      if (!this.rejectModal && el) this.rejectModal = new bootstrap.Modal(el);
      this.rejectModal?.show();
    }, 0);
  }
  closeReject() {
    this.rejectModal?.hide();
    this.activeRequest.set(null);
  }
  async confirmReject() {
    const r = this.activeRequest();
    if (!r) return;
    this.busy.set(true);
    this.rejectError.set(null);
    try {
      await this.api.rejectResetRequest(r.id, this.rejectReason);
      this.rejectModal?.hide();
      this.activeRequest.set(null);
      await this.refresh();
    } catch (e: any) {
      this.rejectError.set(extractError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async refreshExternal() {
    if (this.auth.role() !== "SUPER_MASTER") return;
    this.extLoading.set(true);
    try { this.extSubs.set(await this.api.listExternalSubscriptions()); } catch {}
    finally { this.extLoading.set(false); }
  }

  async addExternal() {
    const raw = this.extInput.trim();
    if (!raw) return;
    // Accept either a bare ID or a full URL with the ID at the end.
    const idMatch = raw.match(/(\d{4,})\s*$/);
    if (!idMatch) {
      this.extError.set("couldn't find a numeric ID in your input — paste the match ID or full indiatoday URL");
      return;
    }
    const id = idMatch[1];
    this.extBusy.set(true);
    this.extError.set(null);
    this.extOk.set(null);
    try {
      await this.api.addExternalSubscription(id);
      this.extOk.set(`Subscribed to ${id} — fetched and added to your slate.`);
      this.extInput = "";
      await this.refreshExternal();
    } catch (e: any) {
      this.extError.set(extractError(e));
    } finally {
      this.extBusy.set(false);
    }
  }

  async removeExternal(id: string) {
    try {
      await this.api.removeExternalSubscription(id);
      await this.refreshExternal();
    } catch (e: any) {
      this.extError.set(extractError(e));
    }
  }

  async regenerateFixtures() {
    this.regenerating.set(true);
    this.regenMsg.set(null);
    try {
      const res = await this.api.regenerateFixtures();
      this.regenMsg.set(`Slate refreshed — deleted ${res.deleted} bet-free matches, generated ${res.generated} new ones.`);
    } catch (e: any) {
      this.regenMsg.set(`Failed: ${extractError(e)}`);
    } finally {
      this.regenerating.set(false);
    }
  }

  // ----- Create / Credit (unchanged) -----
  async onCreate() {
    this.busy.set(true);
    this.createError.set(null);
    this.createOk.set(null);
    try {
      const created = await this.api.createAccount({
        username: this.newUsername.trim(),
        password: this.newPassword,
        role: this.newRole,
      });
      this.createOk.set(`${created.username} [${created.role}]`);
      this.newUsername = "";
      this.newPassword = "";
      await this.refresh();
    } catch (e: any) {
      this.createError.set(extractError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async onCredit() {
    if (!this.creditTargetId || !this.creditAmount) return;
    this.busy.set(true);
    this.creditError.set(null);
    this.creditOk.set(null);
    try {
      const res = await this.api.credit({
        targetUserId: this.creditTargetId,
        amount: Number(this.creditAmount),
        note: this.creditNote || undefined,
      });
      this.creditOk.set(`Applied. Target balance now: ${res.targetBalance}`);
      this.creditAmount = 0;
      this.creditNote = "";
      await this.refresh();
    } catch (e: any) {
      this.creditError.set(extractError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

// Split a seeded app match name like
//   "England v New Zealand — New Zealand tour of England, 2026"
// into meaningful team tokens, dropping noise words.
const NOISE = new Set([
  "tour", "of", "the", "and", "vs", "v", "cup", "series", "trophy",
  "odi", "t20", "test", "women", "men", "national",
  "u19", "u17", "u21", "a", "b",
  "premier", "league",
]);
function tokenizeMatchName(name: string): string[] {
  return name.toLowerCase()
    .replace(/[—–].*$/, "")     // drop everything after em / en dash (series suffix)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3 && !NOISE.has(t));
}

// Score = fraction of app tokens that appear in (team1 + team2 + shorts).
// Range [0, 1]; >=0.5 surfaces a suggestion.
function scoreCricbuzzMatch(appTokens: string[], c: CricbuzzLiveMatch): number {
  const hay = [c.team1, c.team2, c.team1Short, c.team2Short]
    .filter(Boolean).join(" ").toLowerCase();
  let hits = 0;
  for (const t of appTokens) if (hay.includes(t)) hits++;
  return appTokens.length === 0 ? 0 : hits / appTokens.length;
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
