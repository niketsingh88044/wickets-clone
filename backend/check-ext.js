const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const ms = await p.match.findMany({
    where: { externalSource: { not: null } },
    select: { id: true, name: true, inPlay: true, externalId: true, externalSource: true, startTime: true },
  });
  console.log(`External matches in DB: ${ms.length}`);
  ms.forEach(m => console.log(`  [${m.externalSource}/${m.externalId}] ${m.name}  inPlay=${m.inPlay}  startTime=${m.startTime.toISOString()}`));
  await p.$disconnect();
})();
