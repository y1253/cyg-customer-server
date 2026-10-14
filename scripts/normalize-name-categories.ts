/**
 * One-time: give every payee name ONE category (user's rule 2026-10-14 — a name never has
 * two categories). Text only, no OpenAI calls.
 *
 *   npx ts-node -T scripts/normalize-name-categories.ts [--dry-run]
 *
 * 1. Seeds the firm `NameMemory` with each name's most frequent category across every
 *    customer's DONE rows (Uncategorized, splits, bank fees/interest and Owner's Loan
 *    moves left out). Names already in the memory keep theirs (`skipDuplicates`).
 * 2. Per customer, moves every non-split row whose category differs from its name's: the
 *    customer's own category for the name (their NAME rules) first, else the memory's.
 *    Forced defaults (bank fees/interest, Owner's Loan) only follow a customer's own choice,
 *    as in `resolveRow`. Debit/credit are re-derived (the bank side never changes).
 * 3. Sets `taxStale` on every customer it touched, so their next Generate re-tags the taxes
 *    of the moved rows for free.
 *
 * Idempotent: a second run finds nothing to move.
 */
import 'dotenv/config';
import { PrismaClient, StatementStatus } from '@prisma/client';
import {
  ACCOUNT_NAMES,
  OWNERS_LOAN,
  UNCATEGORIZED,
} from '../src/bookkeeping/chart-of-accounts';
import { doubleEntry } from '../src/bookkeeping/ledger.util';
import {
  cleanName,
  indexRules,
  isBankCharge,
  nameKey,
  type NameRule,
} from '../src/bookkeeping/name-memory.util';

const dryRun = process.argv.includes('--dry-run');

const forced = (category: string): boolean =>
  isBankCharge(category) || category === OWNERS_LOAN;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.bankTransaction.findMany({
      where: {
        statement: { deletedAt: null, status: StatementStatus.DONE },
        name: { not: null },
        splitOfId: null,
      },
      select: {
        id: true,
        customerId: true,
        name: true,
        amount: true,
        offsetAccount: true,
        debitAccount: true,
        creditAccount: true,
      },
    });

    // 1. The firm memory: the most frequent category per name.
    const counts = new Map<
      string,
      { sample: string; by: Map<string, number> }
    >();
    for (const r of rows) {
      const name = cleanName(r.name);
      const c = r.offsetAccount;
      if (!name || forced(c) || c === UNCATEGORIZED) continue;
      if (!ACCOUNT_NAMES.includes(c)) continue;
      const k = nameKey(name).slice(0, 191);
      const entry = counts.get(k) ?? { sample: name, by: new Map() };
      entry.by.set(c, (entry.by.get(c) ?? 0) + 1);
      counts.set(k, entry);
    }
    const seeds = [...counts].map(([k, e]) => ({
      nameKey: k,
      sampleName: e.sample,
      category: [...e.by].sort((a, b) => b[1] - a[1])[0][0],
    }));
    const existing = await prisma.nameMemory.findMany({
      select: { nameKey: true, category: true },
    });
    const memory = new Map(existing.map((m) => [m.nameKey, m.category]));
    const fresh = seeds.filter((s) => !memory.has(s.nameKey));
    for (const s of fresh) memory.set(s.nameKey, s.category);
    console.log(
      `${rows.length} named rows · ${seeds.length} names · ${fresh.length} new in NameMemory`,
    );
    if (!dryRun && fresh.length) {
      await prisma.nameMemory.createMany({ data: fresh, skipDuplicates: true });
    }

    // 2. Every row follows its name's one category.
    const rules = await prisma.customerNameRule.findMany({
      select: {
        customerId: true,
        matchType: true,
        matchKey: true,
        name: true,
        category: true,
      },
    });
    const ownBy = new Map<number, Map<string, string>>();
    for (const customerId of new Set(rules.map((r) => r.customerId))) {
      const mine: NameRule[] = rules
        .filter((r) => r.customerId === customerId)
        .map((r) => ({
          ...r,
          matchType: r.matchType === 'DESCRIPTION' ? 'DESCRIPTION' : 'NAME',
        }));
      ownBy.set(customerId, indexRules(mine).nameCategories);
    }

    const moves: Array<{ id: number; customerId: number; data: object }> = [];
    for (const r of rows) {
      const k = nameKey(r.name!);
      const own = ownBy.get(r.customerId)?.get(k);
      const target = own ?? (forced(r.offsetAccount) ? null : memory.get(k));
      if (!target || target === r.offsetAccount) continue;
      const amount = Number(r.amount);
      const bank = amount < 0 ? r.creditAccount : r.debitAccount;
      moves.push({
        id: r.id,
        customerId: r.customerId,
        data: { offsetAccount: target, ...doubleEntry(amount, bank, target) },
      });
    }
    const customers = [...new Set(moves.map((m) => m.customerId))];
    console.log(
      `${moves.length} rows to move, for ${customers.length} customer(s)${dryRun ? ' (dry run)' : ''}`,
    );
    if (dryRun) return;

    for (let i = 0; i < moves.length; i += 200) {
      await prisma.$transaction(
        moves.slice(i, i + 200).map((m) =>
          prisma.bankTransaction.update({
            where: { id: m.id },
            data: m.data,
          }),
        ),
      );
    }
    // 3. Their taxes are re-decided on the next (free) Generate.
    if (customers.length) {
      await prisma.customer.updateMany({
        where: { id: { in: customers } },
        data: { taxStale: true },
      });
    }
    console.log('done');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
