// Wraps the SSE odds streams.
// Components ask for a stream by market id (or "all"), receive MarketTick
// events, and unsubscribe on destroy.

import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { MarketTick } from "../models";
import { environment } from "../../environments/environment";

const API = environment.apiUrl;

@Injectable({ providedIn: "root" })
export class OddsStreamService {
  // Per-market stream
  market(marketId: string): Observable<MarketTick> {
    return new Observable<MarketTick>(subscriber => {
      const es = new EventSource(`${API}/markets/${marketId}/stream`);
      es.addEventListener("tick", (e: MessageEvent) => {
        try { subscriber.next(JSON.parse(e.data)); } catch {}
      });
      es.onerror = () => { /* auto-reconnects */ };
      return () => es.close();
    });
  }

  // All-markets stream (for home / in-play list)
  all(): Observable<MarketTick> {
    return new Observable<MarketTick>(subscriber => {
      const es = new EventSource(`${API}/markets/stream`);
      es.addEventListener("tick", (e: MessageEvent) => {
        try { subscriber.next(JSON.parse(e.data)); } catch {}
      });
      es.onerror = () => {};
      return () => es.close();
    });
  }
}
