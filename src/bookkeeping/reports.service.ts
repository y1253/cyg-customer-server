import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import {
  isCreditCard,
  openingRows,
  startsByAccount,
} from './opening-balance.util';
import { buildReports, type ReportRow, type ReportsView } from './reports.util';
import { CustomerAccountsService } from './customer-accounts.service';
import type { FxEntry } from './fx.service';
import { remainderOf, splitTotals } from './splits.util';
import { FxService } from './fx.service';
import { scopeWhere, type BookScope } from './scope';
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
    private readonly accounts: CustomerAccountsService,
    private readonly fx: FxService,
  ) {}

  async reports(
    scope: BookScope,
    from: string | null,
    to: string | null,
  ): Promise<ReportsView> {
    const done = {
      ...scopeWhere(scope),
      deletedAt: null,
      status: StatementStatus.DONE,
    };
    const [rows, statements, taxes, agencies, customTypes, overrides] =
      await Promise.all([
        this.prisma.bankTransaction.findMany({
          where: { ...scopeWhere(scope), statement: done },
          select: {
            id: true,
            splitOfId: true,
            name: true,
            amount: true,
            offsetAccount: true,
            debitAccount: true,
            creditAccount: true,
            postingDate: true,
            pendingDate: true,
            statementId: true,
            statement: { select: { periodEnd: true } },
          },
        }),
        loadOpeningStatements(this.prisma, scope),
        this.tax.linesFor(scope),
        this.tax.agencyNames(scope),
        this.accounts.types(scope),
        this.accounts.overrides(scope),
      ]);
    const creditCards = new Set(
      statements
        .filter((s) => isCreditCard(s.accountKind))
        .map((s) => s.accountName ?? 'Bank account'),
    );

    // Every amount in the home currency: a foreign statement's rows at their own day's
    // rate, and a revaluation at each foreign statement's end (`FxContext`).
    const fx = await this.fx.context(scope, statements);
    const entries: FxEntry[] = [];
    /** The row's amount converted, plus the original when its statement is foreign. */
    const home = (
      statementId: number,
      date: string | null,
      amount: number,
      bankAccount: string,
    ): { amount: number; foreign?: number } => {
      const { home: converted } = fx.convert(statementId, date, amount);
      entries.push({ statementId, bankAccount, amount, home: converted });
      return fx.isForeign(statementId)
        ? { amount: converted, foreign: amount }
        : { amount: converted };
    };
    // Each statement account's currency — one only when all its statements agree.
    const seen = new Map<string, Set<string>>();
    for (const s of statements) {
      const bank = s.accountName ?? 'Bank account';
      seen.set(bank, (seen.get(bank) ?? new Set()).add(fx.currencyOf(s.id)));
    }
    const bankCurrencies = new Map(
      [...seen]
        .filter(([, cs]) => cs.size === 1)
        .map(([bank, cs]) => {
          const currency = [...cs][0];
          return [bank, { currency, foreign: currency !== fx.home }] as const;
        }),
    );

    // The printed starting balances — the same "Starting balance" rows the ledger shows.
    const openings = openingRows(statements).map((o) => ({
      ...home(o.statementId, day(o.postingDate), o.amount, o.bankAccount),
      offsetAccount: o.offsetAccount,
      bankAccount: o.bankAccount,
      date: day(o.postingDate),
    }));

    // A split-off part counts in its own category; its parent only with what is left.
    const totals = splitTotals(
      rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })),
    );

    const ledgerRows: ReportRow[] = [
      ...openings,
      ...rows.flatMap((r): ReportRow[] => {
        const amount = remainderOf({ ...r, amount: Number(r.amount) }, totals);
        const date =
          day(r.postingDate) ??
          day(r.pendingDate) ??
          day(r.statement.periodEnd);
        // The bank is whichever side is not the offset (see `doubleEntry`).
        const bankAccount =
          Number(r.amount) < 0 ? r.creditAccount : r.debitAccount;
        // A taxed row is split like the ledger shows it: the tax taken OUT of the bank
        // amount, each tax line against the agency.
        const split = taxSplit({ ...r, amount }, taxes.get(r.id) ?? []);
        const rowDate = day(r.postingDate) ?? day(r.pendingDate);
        return [split.parent, ...split.taxes].map((e) => ({
          ...home(r.statementId, rowDate, e.amount, bankAccount),
          offsetAccount: e.offsetAccount,
          bankAccount,
          date,
          name: r.name,
        }));
      }),
    ];
    const revaluations = fx.revaluations(entries).map(
      (f): ReportRow => ({
        amount: f.homeAmount,
        offsetAccount: f.offsetAccount,
        bankAccount: f.bankAccount,
        date: f.date,
        name: null,
        ...(fx.isForeign(f.statementId) && { foreign: 0 }),
      }),
    );
    const view = buildReports([...ledgerRows, ...revaluations], from, to, {
      liabilityAccounts: agencies,
      customTypes,
      overrides,
      creditCards,
      bankCurrencies,
    });
    // Where each statement account's books start, as of the sheet's own date.
    const starts = startsByAccount(openingRows(statements));
    const sheet = view.balanceSheet;
    for (const line of [...sheet.assets, ...sheet.liabilities, ...sheet.equity]) {
      if (!line.bank) continue;
      const list = (starts.get(line.name) ?? []).filter(
        (s) => !to || !s.date || s.date <= to,
      );
      if (list.length) line.starts = list.map((s) => ({ date: s.date }));
    }
    return view;
  }
}
