import { Injectable, inject, signal, computed } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { AuthResponse, Balance, Role, User } from "../models";
import { environment } from "../../environments/environment";

const API = environment.apiUrl;
const STORAGE_KEY = "wickets_token";

@Injectable({ providedIn: "root" })
export class AuthService {
  private http = inject(HttpClient);

  private _user = signal<User | null>(null);
  private _balance = signal<number>(0);
  private _exposure = signal<number>(0);

  user = this._user.asReadonly();
  balance = this._balance.asReadonly();
  exposure = this._exposure.asReadonly();
  isAuthed = computed(() => this._user() !== null);
  role = computed<Role | null>(() => this._user()?.role ?? null);
  isAdmin = computed(() => {
    const r = this._user()?.role;
    return r === "MASTER" || r === "SUPER_MASTER";
  });

  get token(): string | null {
    return localStorage.getItem(STORAGE_KEY);
  }

  async restore() {
    if (!this.token) return;
    try {
      const profile = await firstValueFrom(this.http.get<User>(`${API}/me/profile`));
      const bal = await firstValueFrom(this.http.get<Balance>(`${API}/me/balance`));
      this._user.set({
        id: profile.id,
        username: profile.username,
        role: profile.role,
        balance: bal.balance,
        parent: profile.parent ?? null,
      });
      this._balance.set(bal.balance);
      this._exposure.set(bal.exposure);
    } catch {
      this.logout();
    }
  }

  async refreshBalance() {
    if (!this.token) return;
    const bal = await firstValueFrom(this.http.get<Balance>(`${API}/me/balance`));
    this._balance.set(bal.balance);
    this._exposure.set(bal.exposure);
  }

  setBalance(balance: number, exposure: number) {
    this._balance.set(balance);
    this._exposure.set(exposure);
  }

  async login(username: string, password: string) {
    const res = await firstValueFrom(
      this.http.post<AuthResponse>(`${API}/auth/login`, { username, password })
    );
    localStorage.setItem(STORAGE_KEY, res.token);
    this._user.set({
      id: res.user.id,
      username: res.user.username,
      role: res.user.role,
      balance: res.user.balance,
      parent: res.user.parent ?? null,
    });
    this._balance.set(res.user.balance);
    this._exposure.set(0);
  }

  async register(username: string, password: string) {
    const res = await firstValueFrom(
      this.http.post<AuthResponse>(`${API}/auth/register`, { username, password })
    );
    localStorage.setItem(STORAGE_KEY, res.token);
    this._user.set(res.user);
    this._balance.set(res.user.balance);
    this._exposure.set(0);
  }

  async changePassword(oldPassword: string, newPassword: string) {
    await firstValueFrom(
      this.http.post<{ ok: boolean }>(`${API}/auth/change-password`, { oldPassword, newPassword })
    );
  }

  async withdrawToParent(amount: number, note?: string) {
    const res = await firstValueFrom(
      this.http.post<{
        ok: boolean;
        newBalance: number;
        exposure: number;
        sentTo: { username: string; role: string };
      }>(`${API}/me/withdraw`, { amount, note })
    );
    this._balance.set(res.newBalance);
    this._exposure.set(res.exposure);
    return res;
  }

  logout() {
    localStorage.removeItem(STORAGE_KEY);
    this._user.set(null);
    this._balance.set(0);
    this._exposure.set(0);
  }
}
