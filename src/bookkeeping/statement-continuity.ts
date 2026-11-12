import { StatementStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import {
  num,
  openingChain,
  type OpeningStatement,
} from './opening-balance.util';
import { money } from './statement-problem.util';
import { scopeWhere, type BookScope } from './scope';

/**
 * step2 (2026-11-11, user's request): when a statement opens at a different balance than
 * the previous statement of the same account ended — and their periods touch, so nothing is
 * missing in between — one of the two was read wrong. BOTH are re-read once on the strong
 * model (user's decision), with the neighbours' balances as a hint (`chainHint`). If they
 * still do not carry over, the books start again there and the row says "Statement didn't
 * match" (`statementProblem`).
 */

/** The ids on either side of every MISMATCH break in these accounts. Pure. */
export function mismatchPairs(
  statements: OpeningStatement[] & { bridges?: OpeningStatement[] },
  accounts?: ReadonlySet<string>,
): number[] {
  const ids = new Set<number>();
  for (const r of openingChain(statements)) {
    if (r.reason?.kind !== 'MISMATCH') continue;
    if (accounts && !accounts.has(r.bankAccount)) continue;
    ids.add(r.reason.previousStatementId);
    ids.add(r.statementId);
  }
  return [...ids];
}

/**
 * Queues the strong re-read of both sides of every broken carry-over in `accountNames`
 * (null = every account of the book): DONE, not a bank-feed month (generated, nothing to
 * read), never re-read for this before (`chainRereadAt`). Returns how many were queued.
 * Never throws.
 */
export async function queueChainRereads(
  prisma: PrismaService,
  scope: BookScope,
  accountNames: Array<string | null> | null,
): Promise<number> {
  try {
    const chain = await loadOpeningStatements(prisma, scope);
    const accounts = accountNames
      ? new Set(accountNames.map((n) => n ?? 'Bank account'))
      : undefined;
    const ids = mismatchPairs(chain, accounts);
    if (!ids.length) return 0;
    const { count } = await prisma.bankStatement.updateMany({
      where: {
        ...scopeWhere(scope),
        id: { in: ids },
        deletedAt: null,
        status: StatementStatus.DONE,
        chainRereadAt: null,
        source: { not: 'PLAID' },
      },
      data: { status: StatementStatus.PENDING, chainRereadAt: new Date() },
    });
    return count;
  } catch {
    return 0;
  }
}

/** Where a statement sits in its account's chain (the `openingRows` order). */
const chainTime = (s: OpeningStatement): number =>
  (s.periodStart ?? s.periodEnd)?.getTime() ?? -Infinity;

const isoDay = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

/**
 * What the strong re-read of statement `id` is told about its neighbours: where the
 * previous statement of the account ends and where the next one starts. Null when it has
 * none. The model must copy what is PRINTED — the hint says where to look, never what to
 * write. Pure.
 */
export function chainHint(
  statements: OpeningStatement[],
  id: number,
): string | null {
  const self = statements.find((s) => s.id === id);
  if (!self) return null;
  const account = self.accountName ?? 'Bank account';
  const list = statements
    .filter((s) => (s.accountName ?? 'Bank account') === account)
    .sort((a, b) => chainTime(a) - chainTime(b) || a.id - b.id);
  const at = list.findIndex((s) => s.id === id);
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const read = (n: number | null) => (n === null ? 'not read' : money(n));
  const lines: string[] = [];
  if (prev) {
    const ending =
      prev.closingBalance ??
      (prev.openingBalance === null ? null : prev.openingBalance + prev.net);
    if (ending !== null) {
      lines.push(
        `- The previous statement of this account${prev.periodEnd ? ` (ending ${isoDay(prev.periodEnd)})` : ''} ends at ${money(ending)}. This statement's opening balance was read as ${read(self.openingBalance)}.`,
      );
    }
  }
  if (next?.openingBalance != null) {
    lines.push(
      `- The next statement of this account${next.periodStart ? ` (starting ${isoDay(next.periodStart)})` : ''} opens at ${money(next.openingBalance)}. This statement's closing balance was read as ${read(self.closingBalance)}.`,
    );
  }
  if (!lines.length) return null;
  return [
    "This statement's balances do not carry over from / to the statements next to it in the same account, so one of them was read wrong:",
    ...lines,
    'Read the printed opening balance, closing balance and EVERY transaction on this page again, very carefully. Copy exactly what is PRINTED — never change a figure or a row to make it fit; if this statement really prints a different balance, keep it.',
  ].join('\n');
}

/**
 * `chainHint` for a statement being re-read: the book's chain is loaded as the ledger sees
 * it (DONE + NEEDS_REVIEW), and the statement itself — PROCESSING now, so not in it — is
 * put back with the balances it was read with before. Never throws (null = no hint).
 */
export async function loadChainHint(
  prisma: PrismaService,
  scope: BookScope,
  row: Pick<
    OpeningStatement,
    'id' | 'accountName' | 'accountKind' | 'periodStart' | 'periodEnd'
  > & {
    openingBalance: { toString(): string } | null;
    closingBalance: { toString(): string } | null;
  },
): Promise<string | null> {
  try {
    const chain = await loadOpeningStatements(prisma, scope);
    const all: OpeningStatement[] = [
      ...chain.filter((s) => s.id !== row.id),
      ...chain.bridges.filter((s) => s.id !== row.id),
      {
        ...row,
        openingBalance: num(row.openingBalance),
        closingBalance: num(row.closingBalance),
        net: 0,
      },
    ];
    return chainHint(all, row.id);
  } catch {
    return null;
  }
}
