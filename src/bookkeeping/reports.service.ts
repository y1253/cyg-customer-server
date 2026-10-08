import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import { openingRows } from './opening-balance.util';
import { buildReports, type ReportsView } from './reports.util';

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/**
 * Chart of accounts, income statement and balance sheet over the customer's DONE
 * statements — the same rows the ledger shows. The maths is `buildReports` (pure).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async reports(
    customerId: number,
    from: string | null,
    to: string | null,
  ): Promise<ReportsView> {
    const done = { customerId, deletedAt: null, status: StatementStatus.DONE };
    const [rows, statements] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: { customerId, statement: done },
        select: {
          amount: true,
          offsetAccount: true,
          debitAccount: true,
          creditAccount: true,
          postingDate: true,
          pendingDate: true,
          statement: { select: { periodEnd: true } },
        },
      }),
      loadOpeningStatements(this.prisma, customerId),
    ]);

    // The printed starting balances — the same "Starting balance" rows the ledger shows.
    const openings = openingRows(statements).map((o) => ({
      amount: o.amount,
      offsetAccount: o.offsetAccount,
      bankAccount: o.bankAccount,
      date: day(o.postingDate),
    }));

    return buildReports(
      [
        ...openings,
        ...rows.map((r) => {
          const amount = Number(r.amount);
          return {
            amount,
            offsetAccount: r.offsetAccount,
            // The bank is whichever side is not the offset (see `doubleEntry`).
            bankAccount: amount < 0 ? r.creditAccount : r.debitAccount,
            date:
              day(r.postingDate) ??
              day(r.pendingDate) ??
              day(r.statement.periodEnd),
          };
        }),
      ],
      from,
      to,
    );
  }
}
