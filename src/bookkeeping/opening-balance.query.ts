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
 * printed no closing balance.
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
    }
  >
> {
  const done = { customerId, deletedAt: null, status: StatementStatus.DONE };
  const [statements, sums] = await Promise.all([
    prisma.bankStatement.findMany({
      where: done,
      select: OPENING_STATEMENT_SELECT,
    }),
    prisma.bankTransaction.groupBy({
      by: ['statementId'],
      where: { customerId, statement: done },
      _sum: { amount: true },
    }),
  ]);
  const netOf = new Map(
    sums.map((s) => [s.statementId, Number(s._sum.amount ?? 0)]),
  );
  return statements.map((s) => ({
    ...s,
    openingBalance: num(s.openingBalance),
    closingBalance: num(s.closingBalance),
    net: netOf.get(s.id) ?? 0,
  }));
}
