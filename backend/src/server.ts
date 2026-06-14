import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import matchRoutes from "./routes/matches";
import betRoutes from "./routes/bets";
import adminRoutes from "./routes/admin";
import streamRoutes from "./routes/stream";
import livescoreRoutes from "./routes/livescore";
import { oddsEngine } from "./oddsEngine";
import { settlementEngine } from "./settlementEngine";
import { ensureSlate, promoteMatches } from "./fixtureGenerator";
import { startIngester } from "./indiaTodayIngester";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "wickets-backend" }));

app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/matches", matchRoutes);
app.use("/bets", betRoutes);
app.use("/admin", adminRoutes);
app.use("/livescore", livescoreRoutes);
app.use("/", streamRoutes);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, async () => {
  console.log(`wickets backend listening on http://localhost:${port}`);
  if (process.env.DISABLE_AUTO_SLATE === "1") {
    console.log("[fixtures] DISABLE_AUTO_SLATE=1 — skipping ensureSlate() and promote loop");
  } else {
    try {
      await ensureSlate();
    } catch (e) {
      console.error("[fixtures] ensureSlate failed:", e);
    }
    // Promote matches every 60s so scheduled ones flip to in-play on time.
    setInterval(() => promoteMatches().catch(e => console.error("[fixtures] promote:", e)), 60_000);
  }
  oddsEngine.start();
  settlementEngine.start();
  startIngester();
});
