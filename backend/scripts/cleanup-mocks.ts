// One-shot: delete every mock match (externalSource = null).
// Explicitly cascades manually via raw SQL so SQLite doesn't choke on FK
// integrity checks during a large DELETE. Bets are also nuked; this is a dev
// reset, not a production migration.

import { prisma } from "../src/prisma";

async function main() {
  const before = await prisma.match.count();
  console.log(`Before: ${before} matches`);

  const t0 = Date.now();
  // Child tables first, then parents. Single statements, no row-by-row.
  const delBets = await prisma.$executeRawUnsafe(`
    DELETE FROM Bet WHERE marketId IN (
      SELECT mk.id FROM Market mk
      JOIN Match m ON m.id = mk.matchId
      WHERE m.externalSource IS NULL
    )
  `);
  const delRunners = await prisma.$executeRawUnsafe(`
    DELETE FROM Runner WHERE marketId IN (
      SELECT mk.id FROM Market mk
      JOIN Match m ON m.id = mk.matchId
      WHERE m.externalSource IS NULL
    )
  `);
  const delMarkets = await prisma.$executeRawUnsafe(`
    DELETE FROM Market WHERE matchId IN (
      SELECT id FROM Match WHERE externalSource IS NULL
    )
  `);
  const delMatches = await prisma.$executeRawUnsafe(`
    DELETE FROM Match WHERE externalSource IS NULL
  `);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Deleted in ${elapsed}s: ${delMatches} matches, ${delMarkets} markets, ${delRunners} runners, ${delBets} bets`);
  console.log(`After: ${await prisma.match.count()} matches`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
