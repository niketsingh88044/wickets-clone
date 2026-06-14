import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SUPER_MASTER_USERNAME = "nike";
const SUPER_MASTER_PASSWORD = "nike1234";

async function main() {
  // Wipe everything
  await prisma.bet.deleteMany();
  await prisma.runner.deleteMany();
  await prisma.market.deleteMany();
  await prisma.match.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();

  // ------ Super Master ------
  const passwordHash = await bcrypt.hash(SUPER_MASTER_PASSWORD, 12);
  const superMaster = await prisma.user.create({
    data: {
      username: SUPER_MASTER_USERNAME,
      passwordHash,
      role: "SUPER_MASTER",
      wallet: { create: { balance: 0 } },
    },
  });
  console.log(`super-master created: ${superMaster.username} (id: ${superMaster.id})`);

  // ------ Mock cricket matches (no users seeded; create users via admin panel) ------
  const m1 = await prisma.match.create({
    data: {
      sport: "CRICKET",
      name: "England v New Zealand",
      startTime: new Date(Date.now() - 60 * 60 * 1000),
      inPlay: true,
      markets: {
        create: [
          {
            name: "Match Odds",
            type: "MATCH_ODDS",
            runners: {
              create: [
                { name: "England",     sortOrder: 0, backOdds: 1.52, backSize: 87500, layOdds: 1.53, laySize: 92000 },
                { name: "Draw",        sortOrder: 1, backOdds: 5.6,  backSize: 12000, layOdds: 5.7,  laySize: 11000 },
                { name: "New Zealand", sortOrder: 2, backOdds: 6.2,  backSize: 23000, layOdds: 6.4,  laySize: 19500 },
              ],
            },
          },
          {
            name: "Bookmaker",
            type: "BOOKMAKER",
            maxStake: 50000,
            runners: {
              create: [
                { name: "England",     sortOrder: 0, backOdds: 65, backSize: 60000, layOdds: 67, laySize: 55000 },
                { name: "New Zealand", sortOrder: 1, backOdds: 35, backSize: 60000, layOdds: 37, laySize: 55000 },
              ],
            },
          },
          {
            name: "Ball By Ball",
            type: "FANCY",
            runners: {
              create: [
                { name: "0 RUNS",     sortOrder: 0, backOdds: 2.18, backSize: 99700 },
                { name: "1 RUNS",     sortOrder: 1, backOdds: 2.62, backSize: 90716 },
                { name: "2 RUNS",     sortOrder: 2, backOdds: 7.92, backSize: 99000 },
                { name: "3 RUNS",     sortOrder: 3, backOdds: 11,   backSize: 100000 },
                { name: "4 RUNS",     sortOrder: 4, backOdds: 6.52, backSize: 98400 },
                { name: "6 RUNS",     sortOrder: 5, backOdds: 12.2, backSize: 99500 },
                { name: "WICKET",     sortOrder: 6, backOdds: 6.87, backSize: 100000 },
                { name: "EXTRA RUNS", sortOrder: 7, backOdds: 8.67, backSize: 100000 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.match.create({
    data: {
      sport: "CRICKET",
      name: "Pakistan v Australia",
      startTime: new Date(Date.now() - 30 * 60 * 1000),
      inPlay: true,
      markets: {
        create: [
          {
            name: "Match Odds",
            type: "MATCH_ODDS",
            runners: {
              create: [
                { name: "Pakistan",  sortOrder: 0, backOdds: 1.07, backSize: 150000, layOdds: 1.08, laySize: 145000 },
                { name: "Australia", sortOrder: 1, backOdds: 13.5, backSize: 8000,   layOdds: 15.5, laySize: 7500 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.match.create({
    data: {
      sport: "CRICKET",
      name: "India v Afghanistan",
      startTime: new Date(Date.now() + 18 * 60 * 60 * 1000),
      inPlay: false,
      markets: {
        create: [
          {
            name: "Match Odds",
            type: "MATCH_ODDS",
            runners: {
              create: [
                { name: "India",       sortOrder: 0, backOdds: 1.18, backSize: 50000, layOdds: 1.19, laySize: 48000 },
                { name: "Afghanistan", sortOrder: 1, backOdds: 6.8,  backSize: 8000,  layOdds: 7.2,  laySize: 6500 },
              ],
            },
          },
        ],
      },
    },
  });

  console.log("matches seeded.");
  console.log(`featured match id: ${m1.id}`);
  console.log("");
  console.log("=== HOW TO USE ===");
  console.log(`login as super-master:  username=${SUPER_MASTER_USERNAME}  password=${SUPER_MASTER_PASSWORD}`);
  console.log("then visit /admin to create masters/users and credit their wallets.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
