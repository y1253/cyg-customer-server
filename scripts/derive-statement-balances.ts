/**
 * 2026-11-11: fills the opening / closing balance a stored statement left null from its own
 * rows' running balance (`balancesFromRunning`) — TD prints no "closing balance" line, so
 * every TD statement read before this had none, which broke the starting-balance chain.
 * Only DONE uploaded bank statements whose stored checks are VERIFIED with a passing running
 * balance; a figure is written only when opening + Σ rows = closing to the cent.
 *
 *   npx ts-node -T scripts/derive-statement-balances.ts [--apply] [--book=N]
 *
 * Without `--apply` it only prints what it would change.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import type { Check } from '../src/bookkeeping/reconcile.util';
import { balancesFromRunning } from '../src/bookkeeping/statement-extractor';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bookArg = process.argv.find((a) => a.startsWith('--book='));
  const bookId = bookArg ? Number(bookArg.slice(7)) : undefined;
  const prisma = new PrismaClient();
  try {
    const statements = await prisma.bankStatement.findMany({
      where: {
        deletedAt: null,
        status: 'DONE',
        source: { not: 'PLAID' },
        verification: 'VERIFIED',
        AND: [
          // `not` alone leaves out NULL (SQL `<>`): statements read before accountKind.
          { OR: [{ accountKind: null }, { accountKind: { not: 'CREDIT_CARD' } }] },
          { OR: [{ openingBalance: null }, { closingBalance: null }] },
        ],
        ...(bookId ? { bookId } : {}),
      },
      select: {
        id: true,
        filename: true,
        openingBalance: true,
        closingBalance: true,
        verificationDetail: true,
      },
      orderBy: { id: 'asc' },
    });
    let changed = 0;
    for (const s of statements) {
      const checks = (
        Array.isArray(s.verificationDetail) ? s.verificationDetail : []
      ) as unknown as Check[];
      const rows = await prisma.bankTransaction.findMany({
        where: { statementId: s.id, splitOfId: null },
        orderBy: { position: 'asc' },
        select: { amount: true, balanceAfter: true, postingDate: true },
      });
      const derived = balancesFromRunning(
        rows.map((r) => ({
          amount: Number(r.amount),
          balanceAfter: r.balanceAfter === null ? null : Number(r.balanceAfter),
          postingDate: r.postingDate?.toISOString().slice(0, 10) ?? null,
        })),
        { verification: 'VERIFIED', checks, balanceSign: 1 },
      );
      if (!derived) continue;
      const opening =
        s.openingBalance === null ? derived.opening : Number(s.openingBalance);
      const closing =
        s.closingBalance === null ? derived.closing : Number(s.closingBalance);
      const net = rows.reduce((t, r) => t + Math.round(Number(r.amount) * 100), 0);
      if (
        opening === null ||
        closing === null ||
        Math.round(opening * 100) + net !== Math.round(closing * 100)
      ) {
        console.log(`#${s.id} ${s.filename}: skipped (does not add up)`);
        continue;
      }
      const data = {
        ...(s.openingBalance === null ? { openingBalance: opening } : {}),
        ...(s.closingBalance === null ? { closingBalance: closing } : {}),
      };
      console.log(`#${s.id} ${s.filename}: ${JSON.stringify(data)}`);
      changed++;
      if (apply) {
        await prisma.bankStatement.update({ where: { id: s.id }, data });
      }
    }
    console.log(
      `${changed} of ${statements.length} statement(s) ${apply ? 'updated' : 'would be updated (dry run — pass --apply)'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
