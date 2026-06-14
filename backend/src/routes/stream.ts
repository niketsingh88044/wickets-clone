// Server-Sent Events endpoints for live odds + in-play list.
// Browser uses EventSource() to subscribe; server pushes JSON payloads.

import { Router, Request, Response } from "express";
import { oddsEngine, MarketTick } from "../oddsEngine";
import { settlementEngine, SettleEvent } from "../settlementEngine";

const router = Router();

function setupSseHeaders(res: Response) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
}

function sseSend(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Per-match stream: receives ticks AND settle events for any market on the match.
// (We listen to all and filter — simpler for the demo than per-market binding
//  through a match because new markets spawn during ball-by-ball cycling.)
router.get("/matches/:id/stream", (req: Request, res: Response) => {
  const matchId = req.params.id;
  setupSseHeaders(res);
  sseSend(res, "ready", { matchId });

  const onTick = (tick: MarketTick) => sseSend(res, "tick", tick);
  const onSettle = (ev: SettleEvent) => {
    if (ev.matchId === matchId) sseSend(res, "settled", ev);
  };
  oddsEngine.on("market-tick", onTick);
  settlementEngine.on("market-settled", onSettle);

  const heartbeat = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    oddsEngine.off("market-tick", onTick);
    settlementEngine.off("market-settled", onSettle);
    res.end();
  });
});

// Per-market stream: receives only ticks for this market + its settlement.
router.get("/markets/:id/stream", (req: Request, res: Response) => {
  const marketId = req.params.id;
  setupSseHeaders(res);
  sseSend(res, "ready", { marketId });

  const onTick = (tick: MarketTick) => sseSend(res, "tick", tick);
  const onSettle = (ev: SettleEvent) => sseSend(res, "settled", ev);
  oddsEngine.on(`market-tick:${marketId}`, onTick);
  settlementEngine.on(`market-settled:${marketId}`, onSettle);

  const heartbeat = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    oddsEngine.off(`market-tick:${marketId}`, onTick);
    settlementEngine.off(`market-settled:${marketId}`, onSettle);
    res.end();
  });
});

// Aggregate stream: every market tick + settle across the system.
// Useful for the home/in-play list to update odds inline and reflect finished markets.
router.get("/markets/stream", (req: Request, res: Response) => {
  setupSseHeaders(res);
  sseSend(res, "ready", { all: true });

  const onTick = (tick: MarketTick) => sseSend(res, "tick", tick);
  const onSettle = (ev: SettleEvent) => sseSend(res, "settled", ev);
  oddsEngine.on("market-tick", onTick);
  settlementEngine.on("market-settled", onSettle);

  const heartbeat = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    oddsEngine.off("market-tick", onTick);
    settlementEngine.off("market-settled", onSettle);
    res.end();
  });
});

export default router;
