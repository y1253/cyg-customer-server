import { Prisma, StatementStatus, type PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import { openingChain } from './opening-balance.util';
import {
  changes,
  planStatementFix,
  type StatementFix,
} from './rolling-backfill.util';
import { mismatchPairs } from './statement-continuity';
import { scopeWhere, type BookScope } from './scope';

/**
 * 2026-11-25 (user's request): the ONE-TIME rolling backfill, run by hand on the host (the
 * host has no ts-node, so it lives in `src/` and ships in `dist/`):
 *
 *   node --env-file=.env -e "require('./dist/bookkeeping/rolling-backfill').main()" -- fix [--apply] [--book=N]
 *   node --env-file=.env -e "require('./dist/bookkeeping/rolling-backfill').main()" -- reread [--apply] [--book=N]
 *
 * `fix`: every DONE uploaded statement gets the pure repairs (`planStatementFix`) on its
 * stored rows and figures, and every book it touched is marked unchecked (`errorsCheckedAt`
 * null) — `pm2 restart customer` then saves the errors again (90 s boot backfill).
 * `reread`: after that, every statement on either side of a break that still does not carry
 * over (`mismatchPairs`) or with an open ENDING / RUNNING error is read again on the strong
 * model with its neighbours' balances (`chainRereadAt`) — a reading that checks out worse
 * keeps the old one (`StatementProcessorService.processOne`). MISSING gaps are never re-read.
 * Without `--apply` it only reports.
 */

type Db = PrismaClient | PrismaService;
const asService = (db: Db) => db as unknown as PrismaService;

export interface BookReport {
  bookId: number;
  starts: Record<string, { before: number; after?: number }>;
  fixed: Array<{ statementId: number } & Omit<StatementFix, 'detail'>>;
  skipped: Array<{ statementId: number; why: string }>;
  rereads: number[];
}

async function books(db: Db, bookId?: number): Promise<BookScope[]> {
  const rows = await db.bankStatement.findMany({
    where: {
      deletedAt: null,
      status: StatementStatus.DONE,
      source: { not: 'PLAID' },
      ...(bookId ? { bookId } : {}),
    },
    distinct: ['bookId'],
    select: { customerId: true, bookId: true, companyId: true },
    orderBy: { bookId: 'asc' },
  });
  return rows;
}

/** How many times each account starts (every entry of `openingChain`). */
async function startsOf(
  db: Db,
  scope: BookScope,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of openingChain(
    await loadOpeningStatements(asService(db), scope),
  )) {
    out.set(r.bankAccount, (out.get(r.bankAccount) ?? 0) + 1);
  }
  return out;
}

const n = (d: { toString(): string } | null): number | null =>
  d === null ? null : Number(d);

async function fixBook(
  db: Db,
  scope: BookScope,
  apply: boolean,
): Promise<BookReport> {
  const report: BookReport = {
    bookId: scope.bookId,
    starts: {},
    fixed: [],
    skipped: [],
    rereads: [],
  };
  for (const [account, count] of await startsOf(db, scope)) {
    report.starts[account] = { before: count };
  }
  const statements = await db.bankStatement.findMany({
    where: {
      ...scopeWhere(scope),
      deletedAt: null,
      status: StatementStatus.DONE,
      source: { not: 'PLAID' },
    },
    orderBy: { id: 'asc' },
  });
  for (const s of statements) {
    const rows = await db.bankTransaction.findMany({
      where: { statementId: s.id, splitOfId: null },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        amount: true,
        balanceAfter: true,
        postingDate: true,
        debitAccount: true,
        creditAccount: true,
      },
    });
    const split = new Set(
      (
        await db.bankTransaction.findMany({
          where: { statementId: s.id, splitOfId: { not: null } },
          select: { splitOfId: true },
          distinct: ['splitOfId'],
        })
      ).map((r) => r.splitOfId),
    );
    const fix = planStatementFix(
      {
        openingBalance: n(s.openingBalance),
        closingBalance: n(s.closingBalance),
        statedDeposits: n(s.statedDeposits),
        statedWithdrawals: n(s.statedWithdrawals),
        statedDepositCount: s.statedDepositCount,
        statedWithdrawalCount: s.statedWithdrawalCount,
        verification: s.verification,
        accountKind: s.accountKind,
      },
      rows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        balanceAfter: n(r.balanceAfter),
        postingDate: r.postingDate?.toISOString().slice(0, 10) ?? null,
        locked: split.has(r.id),
      })),
    );
    if (fix.skipped)
      report.skipped.push({ statementId: s.id, why: fix.skipped });
    if (!changes(fix)) continue;
    const { detail, ...shown } = fix;
    report.fixed.push({ statementId: s.id, ...shown });
    if (!apply) continue;
    const byId = new Map(rows.map((r) => [r.id, r]));
    await db.$transaction([
      ...fix.flips.map((id) => {
        const r = byId.get(id)!;
        return db.bankTransaction.update({
          where: { id },
          data: {
            amount: (-Number(r.amount)).toFixed(2),
            debitAccount: r.creditAccount,
            creditAccount: r.debitAccount,
          },
        });
      }),
      ...fix.balances.map((b) =>
        db.bankTransaction.update({
          where: { id: b.id },
          data: {
            balanceAfter:
              b.balanceAfter === null ? null : b.balanceAfter.toFixed(2),
          },
        }),
      ),
      db.bankStatement.update({
        where: { id: s.id },
        data: {
          ...(fix.opening !== undefined
            ? { openingBalance: fix.opening.toFixed(2) }
            : {}),
          ...(fix.closing !== undefined
            ? { closingBalance: fix.closing.toFixed(2) }
            : {}),
          ...(fix.verification
            ? {
                verification: fix.verification,
                verificationDetail: detail as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      }),
    ]);
  }
  if (apply && report.fixed.length) {
    await db.$executeRaw`
      UPDATE BankStatement SET errorsCheckedAt = NULL
      WHERE bookId = ${scope.bookId} AND deletedAt IS NULL`;
  }
  for (const [account, count] of await startsOf(db, scope)) {
    report.starts[account] = {
      ...(report.starts[account] ?? { before: 0 }),
      after: count,
    };
  }
  return report;
}

async function rereadBook(
  db: Db,
  scope: BookScope,
  apply: boolean,
): Promise<BookReport> {
  const report: BookReport = {
    bookId: scope.bookId,
    starts: {},
    fixed: [],
    skipped: [],
    rereads: [],
  };
  for (const [account, count] of await startsOf(db, scope)) {
    report.starts[account] = { before: count };
  }
  const pairs = mismatchPairs(
    await loadOpeningStatements(asService(db), scope),
  );
  const open = await db.statementError.findMany({
    where: {
      resolvedAt: null,
      source: 'SYSTEM',
      kind: { in: ['ENDING', 'RUNNING'] },
      statementId: {
        in: (
          await db.bankStatement.findMany({
            where: { ...scopeWhere(scope), deletedAt: null },
            select: { id: true },
          })
        ).map((s) => s.id),
      },
    },
    select: { statementId: true },
  });
  const ids = [...new Set([...pairs, ...open.map((e) => e.statementId)])];
  const queue = await db.bankStatement.findMany({
    where: {
      ...scopeWhere(scope),
      id: { in: ids },
      deletedAt: null,
      status: StatementStatus.DONE,
      source: { not: 'PLAID' },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  report.rereads = queue.map((s) => s.id);
  if (apply && queue.length) {
    await db.bankStatement.updateMany({
      where: { id: { in: report.rereads }, status: StatementStatus.DONE },
      data: {
        status: StatementStatus.PENDING,
        attempts: 0,
        runs: 0,
        error: null,
        errorDetail: null,
        chainRereadAt: new Date(),
      },
    });
  }
  return report;
}

export async function runRollingBackfill(
  db: Db,
  opts: { phase: 'fix' | 'reread'; apply: boolean; bookId?: number },
): Promise<BookReport[]> {
  const out: BookReport[] = [];
  for (const scope of await books(db, opts.bookId)) {
    const r =
      opts.phase === 'fix'
        ? await fixBook(db, scope, opts.apply)
        : await rereadBook(db, scope, opts.apply);
    if (r.fixed.length || r.skipped.length || r.rereads.length) out.push(r);
  }
  return out;
}

/** The command line (see the top of the file). Prints the report as JSON. */
export async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: Client } = require('@prisma/client') as {
    PrismaClient: new () => PrismaClient;
  };
  const args = process.argv.slice(1);
  const phase = args.includes('reread') ? 'reread' : 'fix';
  const book = args.find((a) => a.startsWith('--book='));
  const db = new Client();
  try {
    const report = await runRollingBackfill(db, {
      phase,
      apply: args.includes('--apply'),
      bookId: book ? Number(book.slice(7)) : undefined,
    });
    console.log(
      JSON.stringify(
        { phase, apply: args.includes('--apply'), report },
        null,
        1,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
