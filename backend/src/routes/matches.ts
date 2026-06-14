import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

router.get("/", async (req, res) => {
  const filter = req.query.filter as string | undefined;
  const where: any = {};
  if (filter === "in-play") where.inPlay = true;
  else if (filter === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    where.startTime = { gte: start, lt: end };
  } else if (filter === "tomorrow") {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + 1);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    where.startTime = { gte: start, lt: end };
  }
  const matches = await prisma.match.findMany({
    where,
    orderBy: [{ inPlay: "desc" }, { startTime: "asc" }],
    include: {
      markets: {
        include: {
          runners: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true, backOdds: true, layOdds: true, sortOrder: true },
          },
        },
      },
    },
  });
  res.json(matches);
});

router.get("/:id", async (req, res) => {
  const match = await prisma.match.findUnique({
    where: { id: req.params.id },
    include: {
      markets: {
        include: { runners: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!match) return res.status(404).json({ error: "match not found" });
  res.json(match);
});

router.get("/markets/:id", async (req, res) => {
  const market = await prisma.market.findUnique({
    where: { id: req.params.id },
    include: { runners: { orderBy: { sortOrder: "asc" } }, match: true },
  });
  if (!market) return res.status(404).json({ error: "market not found" });
  res.json(market);
});

export default router;
