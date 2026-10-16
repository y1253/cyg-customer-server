/**
 * One-time repair: put back together bank accounts that were split in two because the AI
 * named the same account two ways ("TD Canada Trust 5234" on some statements, "TD Canada
 * Trust 5234496" on others — 2026-10-15). New statements no longer split
 * (`account-identity.util.ts`); this fixes the ones already read.
 *
 * Per customer, names are grouped with the SAME rule new statements use (same bank text,
 * same kind, digits a prefix/suffix of each other, ≥ 4 digits — `mergeGroups`). A group
 * keeps the name used by the most statements. Ambiguous groups are left alone. In one
 * transaction per customer it renames:
 *   - `BankStatement.accountName`
 *   - `BankTransaction.debitAccount` / `creditAccount` (the bank side carries the name)
 *   - `CustomerAccountType.account` (a "Move to…" override; dropped if the kept name has one)
 * Starting balances are computed on read, so they re-chain by themselves. No OpenAI.
 * Idempotent: a second run finds nothing to merge.
 *
 *   npx ts-node -T scripts/merge-split-accounts.ts [--dry-run]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mergeGroups } from '../src/bookkeeping/account-identity.util';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const counts = await prisma.bankStatement.groupBy({
      by: ['customerId', 'accountName', 'accountKind'],
      where: { deletedAt: null, accountName: { not: null } },
      _count: { _all: true },
    });
    const byCustomer = new Map<number, typeof counts>();
    for (const c of counts) {
      byCustomer.set(c.customerId, [...(byCustomer.get(c.customerId) ?? []), c]);
    }

    let merged = 0;
    for (const [customerId, rows] of byCustomer) {
      // One entry per name: a name read under two kinds counts under its usual kind.
      const perName = new Map<string, { kind: string | null; statements: number; best: number }>();
      for (const r of rows) {
        const name = r.accountName!;
        const cur = perName.get(name);
        const n = r._count._all;
        if (!cur) perName.set(name, { kind: r.accountKind, statements: n, best: n });
        else {
          cur.statements += n;
          if (n > cur.best) Object.assign(cur, { kind: r.accountKind, best: n });
        }
      }
      const groups = mergeGroups(
        [...perName].map(([name, v]) => ({ name, kind: v.kind, statements: v.statements })),
      );
      if (!groups.length) continue;

      for (const g of groups) {
        console.log(
          `customer ${customerId}: ${g.merge.map((m) => `"${m}"`).join(', ')} → "${g.keep}"`,
        );
      }
      merged += groups.reduce((n, g) => n + g.merge.length, 0);
      if (dryRun) continue;

      await prisma.$transaction(async (tx) => {
        for (const g of groups) {
          for (const old of g.merge) {
            await tx.bankStatement.updateMany({
              where: { customerId, accountName: old },
              data: { accountName: g.keep },
            });
            await tx.bankTransaction.updateMany({
              where: { customerId, debitAccount: old },
              data: { debitAccount: g.keep },
            });
            await tx.bankTransaction.updateMany({
              where: { customerId, creditAccount: old },
              data: { creditAccount: g.keep },
            });
            const kept = await tx.customerAccountType.findUnique({
              where: { customerId_account: { customerId, account: g.keep } },
            });
            if (kept) {
              await tx.customerAccountType.deleteMany({ where: { customerId, account: old } });
            } else {
              await tx.customerAccountType.updateMany({
                where: { customerId, account: old },
                data: { account: g.keep },
              });
            }
          }
        }
      });
    }
    console.log(
      `${dryRun ? '[dry run] would merge' : 'merged'} ${merged} account name(s) into their account`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
