import { Injectable, signal } from "@angular/core";
import { BetSlipSelection } from "../models";

@Injectable({ providedIn: "root" })
export class BetSlipService {
  private _selection = signal<BetSlipSelection | null>(null);
  selection = this._selection.asReadonly();

  open(sel: BetSlipSelection) {
    this._selection.set(sel);
  }

  clear() {
    this._selection.set(null);
  }
}
