import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import { openingRows } from './opening-balance.util';
import { buildReports, type ReportRow, type ReportsView } from './reports.util';
import { TaxService } from './tax.service';
import { taxReportRows } from './tax.util';

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/**
 * Chart of accounts, income statement and balance sheet over the customer's DONE
 * statements — the same rows the ledger shows. The maths is `buildReports` (pure).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
  ) {}

  async reports(
    customerId: number,
    from: string | null,
    to: string | null,
  ): Promise<ReportsView> {
    const done = { customerId, deletedAt: null, status: StatementStatus.DONE };
    const [rows, statements, taxes, agencies] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: { customerId, statement: done },
        select: {
          id: true,
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
      this.tax.linesFor(customerId),
      this.tax.agencyNames(customerId),
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
        ...rows.flatMap((r): ReportRow[] => {
          const amount = Number(r.amount);
          const date =
            day(r.postingDate) ??
            day(r.pendingDate) ??
            day(r.statement.periodEnd);
          return [
            {
              amount,
              offsetAccount: r.offsetAccount,
              // The bank is whichever side is not the offset (see `doubleEntry`).
              bankAccount: amount < 0 ? r.creditAccount : r.debitAccount,
              date,
            },
            // Its tax lines: agency ↔ the row's own account, no cash side.
            ...(taxes.get(r.id) ?? []).flatMap((t) =>
              taxReportRows(t.kind, r.offsetAccount, t.agency, t.amount).map(
                (x) => ({ ...x, bankAccount: null, date }),
              ),
            ),
          ];
        }),
      ],
      from,
      to,
      agencies,
    );
  }
}
