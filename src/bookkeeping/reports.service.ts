import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildReports,
  type OpeningBalance,
  type ReportsView,
} from './reports.util';

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
      this.prisma.bankStatement.findMany({
        where: done,
        select: { accountName: true, openingBalance: true, periodStart: true },
        orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // The bank's balance before the EARLIEST statement we hold, per bank account.
    // `processOne` names a statement with no account "Bank account" — match it.
    const openings: OpeningBalance[] = [];
    const seen = new Set<string>();
    for (const s of statements) {
      const bankAccount = s.accountName ?? 'Bank account';
      if (seen.has(bankAccount)) continue;
      seen.add(bankAccount);
      if (s.openingBalance !== null) {
        openings.push({ bankAccount, amount: Number(s.openingBalance) });
      }
    }

    return buildReports(
      rows.map((r) => {
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
      openings,
      from,
      to,
    );
  }
}
