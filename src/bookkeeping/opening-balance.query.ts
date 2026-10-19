import { StatementStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  num,
  OPENING_STATEMENT_SELECT,
  type OpeningStatement,
} from './opening-balance.util';

/**
 * The customer's DONE statements, ready for `openingRows` — plus the label fields
 * (`statementLabel`). `net` is Σ amount of each statement's rows, for statements that
 * printed no closing balance. `currency` is the EFFECTIVE one: the customer's own setting
 * for the account (`CustomerAccountCurrency`) wins over what the AI read off the statement,
 * so every reader (ledger, reports, export) converts with it.
 */
export async function loadOpeningStatements(
  prisma: PrismaService,
  customerId: number,
): Promise<
  Array<
    OpeningStatement & {
      bankName: string | null;
      filename: string;
      periodEnd: Date | null;
      currency: string | null;
    }
  >
> {
  const done = { customerId, deletedAt: null, status: StatementStatus.DONE };
  const [statements, sums, currencies] = await Promise.all([
    prisma.bankStatement.findMany({
      where: done,
      select: OPENING_STATEMENT_SELECT,
    }),
    prisma.bankTransaction.groupBy({
      by: ['statementId'],
      // Splits are parts of their parent's amount, already in it.
      where: { customerId, statement: done, splitOfId: null },
      _sum: { amount: true },
    }),
    accountCurrencies(prisma, customerId),
  ]);
  const netOf = new Map(
    sums.map((s) => [s.statementId, Number(s._sum.amount ?? 0)]),
  );
  return statements.map((s) => ({
    ...s,
    currency: effectiveCurrency(s, currencies),
    openingBalance: num(s.openingBalance),
    closingBalance: num(s.closingBalance),
    net: netOf.get(s.id) ?? 0,
  }));
}

/** The currencies the customer set for their accounts, by account name. */
export async function accountCurrencies(
  prisma: PrismaService,
  customerId: number,
): Promise<Map<string, string>> {
  const rows = await prisma.customerAccountCurrency.findMany({
    where: { customerId },
    select: { account: true, currency: true },
  });
  return new Map(rows.map((r) => [r.account, r.currency]));
}

/** The customer's setting for the statement's account, else what was read off it. */
export const effectiveCurrency = (
  s: { accountName: string | null; currency: string | null },
  set: ReadonlyMap<string, string>,
): string | null => (s.accountName && set.get(s.accountName)) || s.currency;
