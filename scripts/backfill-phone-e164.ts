/**
 * One-time backfill of `Customer.phoneE164` from `phone`, for accounts that saved a phone
 * before texts to intake numbers existed. Idempotent: it rewrites only rows whose stored
 * value differs from what `toE164` gives now.
 *
 *   npx ts-node -T scripts/backfill-phone-e164.ts [--dry-run]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { toE164 } from '../src/customer-auth/phone-number.util';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.customer.findMany({
      select: { id: true, phone: true, phoneE164: true },
    });
    let changed = 0;
    for (const r of rows) {
      const want = toE164(r.phone);
      if (want === r.phoneE164) continue;
      changed++;
      if (!dryRun) {
        await prisma.customer.update({
          where: { id: r.id },
          data: { phoneE164: want },
        });
      }
    }
    console.log(
      `${rows.length} customers, ${changed} ${dryRun ? 'would change' : 'updated'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
