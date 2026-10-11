/**
 * One-time seed of the FIRM memory (`DescriptionMemory`) from statements already read, so
 * the names and categories the AI worked out before the memory existed are kept even if
 * those statements are deleted. Text only — no OpenAI calls.
 *
 *   npx ts-node -T scripts/seed-description-memory.ts [--dry-run]
 *
 * Per description key, the most frequent AI name and category across every customer's DONE
 * statements is stored. Rows a customer rule has already changed are still AI answers here,
 * because no rules exist before this ships. Idempotent: keys already in the memory are
 * skipped (`skipDuplicates`), so a re-run only adds what is new.
 */
import 'dotenv/config';
import { PrismaClient, StatementStatus } from '@prisma/client';
import {
  memoryWrites,
  descriptionKey,
} from '../src/bookkeeping/name-memory.util';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.bankTransaction.findMany({
      where: {
        statement: { deletedAt: null, status: StatementStatus.DONE },
      },
      select: { description: true, name: true, offsetAccount: true },
    });

    // Most frequent (name, category) per key — `memoryWrites` keeps the FIRST row per key,
    // so feed it the winner of each key first.
    type Tally = Map<string, { row: (typeof rows)[number]; n: number }>;
    const tally = new Map<string, Tally>();
    for (const r of rows) {
      const key = descriptionKey(r.description);
      if (!key) continue;
      const variant = `${(r.name ?? '').toLowerCase()}|${r.offsetAccount}`;
      const byVariant: Tally = tally.get(key) ?? (new Map() as Tally);
      const entry = byVariant.get(variant) ?? { row: r, n: 0 };
      entry.n++;
      byVariant.set(variant, entry);
      tally.set(key, byVariant);
    }
    const winners = [...tally.values()].map(
      (byVariant) => [...byVariant.values()].sort((a, b) => b.n - a.n)[0].row,
    );

    const existing = await prisma.descriptionMemory.findMany({
      select: { descriptionKey: true, name: true, category: true },
    });
    const memory = new Map(
      existing.map((m) => [
        m.descriptionKey,
        { name: m.name, category: m.category },
      ]),
    );
    const { creates } = memoryWrites(winners, memory);

    console.log(
      `${rows.length} transaction(s), ${tally.size} description key(s), ${existing.length} already in memory, ${creates.length} to add`,
    );
    if (dryRun || !creates.length) {
      if (dryRun) console.log('dry run — nothing written');
      return;
    }
    for (let i = 0; i < creates.length; i += 500) {
      const res = await prisma.descriptionMemory.createMany({
        data: creates.slice(i, i + 500),
        skipDuplicates: true,
      });
      console.log(`added ${res.count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
