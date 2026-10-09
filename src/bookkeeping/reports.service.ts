import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import { openingRows } from './opening-balance.util';
import { buildReports, type ReportRow, type ReportsView } from './reports.util';
import { TaxService } from './tax.service';
import { taxSplit } from './tax.util';

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
          // The bank is whichever side is not the offset (see `doubleEntry`).
          const bankAccount = amount < 0 ? r.creditAccount : r.debitAccount;
          // A taxed row is split like the ledger shows it: the row net of its tax, and
          // each tax line its share of the same bank movement, against the agency.
          const split = taxSplit({ ...r, amount }, taxes.get(r.id) ?? []);
          return [split.parent, ...split.taxes].map((e) => ({
            amount: e.amount,
            offsetAccount: e.offsetAccount,
            bankAccount,
            date,
          }));
        }),
      ],
      from,
      to,
      agencies,
    );
  }
}
