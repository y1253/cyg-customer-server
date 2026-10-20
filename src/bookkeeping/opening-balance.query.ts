import { StatementStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  num,
  OPENING_STATEMENT_SELECT,
  type OpeningStatement,
} from './opening-balance.util';
import { scopeWhere, type BookScope } from './scope';

/**
 * One book's DONE statements (plus its NEEDS_REVIEW ones as `bridges`), ready for
 * `openingRows` — plus the label fields
 * (`statementLabel`). `net` is Σ amount of each statement's rows, for statements that
 * printed no closing balance. `currency` is the EFFECTIVE one: the customer's own setting
 * for the account (`CustomerAccountCurrency`) wins over what the AI read off the statement,
 * so every reader (ledger, reports, export) converts with it.
 */
export async function loadOpeningStatements(
  prisma: PrismaService,
  scope: BookScope,
): Promise<
  Array<
    OpeningStatement & {
      bankName: string | null;
      filename: string;
      periodEnd: Date | null;
      currency: string | null;
    }
  > & { bridges: OpeningStatement[] }
> {
  // DONE = in the ledger. NEEDS_REVIEW = not in it, but still links the starting-balance
  // chain (`openingRows` bridges) — handed back on the side, so no other reader sees it.
  const where = (status: StatementStatus) => ({
    ...scopeWhere(scope),
    deletedAt: null,
    status,
  });
  const read = {
    ...scopeWhere(scope),
    deletedAt: null,
    status: { in: [StatementStatus.DONE, StatementStatus.NEEDS_REVIEW] },
  };
  const [statements, review, sums, currencies] = await Promise.all([
    prisma.bankStatement.findMany({
      where: where(StatementStatus.DONE),
      select: OPENING_STATEMENT_SELECT,
    }),
    prisma.bankStatement.findMany({
      where: where(StatementStatus.NEEDS_REVIEW),
      select: OPENING_STATEMENT_SELECT,
    }),
    prisma.bankTransaction.groupBy({
      by: ['statementId'],
      // Splits are parts of their parent's amount, already in it.
      where: { ...scopeWhere(scope), statement: read, splitOfId: null },
      _sum: { amount: true },
    }),
    accountCurrencies(prisma, scope),
  ]);
  const netOf = new Map(
    sums.map((s) => [s.statementId, Number(s._sum.amount ?? 0)]),
  );
  const view = (s: (typeof statements)[number]) => ({
    ...s,
    currency: effectiveCurrency(s, currencies),
    openingBalance: num(s.openingBalance),
    closingBalance: num(s.closingBalance),
    net: netOf.get(s.id) ?? 0,
  });
  const done = statements.map(view);
  const bridges = review.map(view);
  return Object.assign(done, { bridges });
}

/** The currencies set for one book's accounts, by account name. */
export async function accountCurrencies(
  prisma: PrismaService,
  scope: BookScope,
): Promise<Map<string, string>> {
  const rows = await prisma.customerAccountCurrency.findMany({
    where: scopeWhere(scope),
    select: { account: true, currency: true },
  });
  return new Map(rows.map((r) => [r.account, r.currency]));
}

/** The customer's setting for the statement's account, else what was read off it. */
export const effectiveCurrency = (
  s: { accountName: string | null; currency: string | null },
  set: ReadonlyMap<string, string>,
): string | null => (s.accountName && set.get(s.accountName)) || s.currency;
