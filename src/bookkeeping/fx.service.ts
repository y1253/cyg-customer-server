import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FX_CURRENCIES,
  isFxCurrency,
  rateOn,
  revaluationRows,
  toHome,
  type FxRow,
  type RateSeries,
} from './fx.util';

const VALET = 'https://www.bankofcanada.ca/valet/observations';
/** Rates are looked up from this many days before a period (a holiday-long weekend). */
const LOOKBACK_DAYS = 10;
/** A failed or empty fetch for a range is not retried for this long. */
const RETRY_MS = 60 * 60_000;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) =>
  iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));

/** One statement as conversion sees it. */
export interface FxStatementInfo {
  id: number;
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/** One ledger entry's bank side, for the revaluation at its statement's end. */
export interface FxEntry {
  statementId: number;
  bankAccount: string;
  /** In the statement's currency. */
  amount: number;
  /** The same, converted. */
  home: number;
}

/**
 * Everything a reader (ledger, reports, export) needs to put a customer's foreign
 * statements in the home currency: the rate of each row's day, and the revaluation rows
 * at each foreign statement's end. Built once per request by `FxService.context`.
 */
export class FxContext {
  constructor(
    readonly home: string,
    private readonly statements: ReadonlyMap<number, FxStatementInfo>,
    private readonly series: ReadonlyMap<string, RateSeries>,
  ) {}

  /** The statement's currency — the home currency when nothing on it said. */
  currencyOf(statementId: number): string {
    return this.statements.get(statementId)?.currency || this.home;
  }

  isForeign(statementId: number): boolean {
    return this.currencyOf(statementId) !== this.home;
  }

  /** True when any statement is in another currency. */
  get anyForeign(): boolean {
    return [...this.statements.keys()].some((id) => this.isForeign(id));
  }

  /**
   * Statement currency → home on `date` (a row's posting date; else the statement's end,
   * then its start). 1 for a home-currency statement; null when no rate is known.
   */
  rate(statementId: number, date: string | null): number | null {
    const from = this.currencyOf(statementId);
    if (from === this.home) return 1;
    const s = this.statements.get(statementId);
    const day =
      date ??
      (s?.periodEnd ? iso(s.periodEnd) : null) ??
      (s?.periodStart ? iso(s.periodStart) : null);
    if (!day) return null;
    return rateOn(from, this.home, day, (c) => this.series.get(c));
  }

  /** `amount` in the home currency; unconverted (rate null) when no rate is known. */
  convert(
    statementId: number,
    date: string | null,
    amount: number,
  ): { home: number; rate: number | null } {
    const rate = this.rate(statementId, date);
    return { home: rate === null ? amount : toHome(amount, rate), rate };
  }

  /** The revaluation rows of every foreign statement, from the entries a reader produced. */
  revaluations(entries: readonly FxEntry[]): FxRow[] {
    const per = new Map<
      number,
      { bankAccount: string; foreign: number; home: number }
    >();
    for (const e of entries) {
      if (!this.isForeign(e.statementId)) continue;
      const t = per.get(e.statementId) ?? {
        bankAccount: e.bankAccount,
        foreign: 0,
        home: 0,
      };
      t.foreign += e.amount;
      t.home += e.home;
      per.set(e.statementId, t);
    }
    return revaluationRows(
      [...per.entries()].map(([statementId, t]) => {
        const end = this.statements.get(statementId)?.periodEnd ?? null;
        const periodEnd = end ? iso(end) : null;
        return {
          statementId,
          bankAccount: t.bankAccount,
          periodEnd,
          foreign: Math.round(t.foreign * 100) / 100,
          home: Math.round(t.home * 100) / 100,
          closingRate: periodEnd ? this.rate(statementId, periodEnd) : null,
        };
      }),
    );
  }
}

/**
 * Home currency + Bank of Canada daily rates (Valet API, no key; `FxRate` caches them
 * firm-wide). Conversion happens on READ (`FxContext`), so changing the home currency, or
 * a rate arriving late, needs no rewrite of any row.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  /** currency:from:to → when it was last fetched, so a gap is not re-fetched every read. */
  private readonly tried = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async home(customerId: number): Promise<string> {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { homeCurrency: true },
    });
    return c?.homeCurrency || 'CAD';
  }

  async setHome(customerId: number, currency: string): Promise<string> {
    const code = currency.trim().toUpperCase();
    if (!isFxCurrency(code)) {
      throw new BadRequestException(
        `${code} is not a currency we have daily rates for`,
      );
    }
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { homeCurrency: code },
    });
    return code;
  }

  /** The currencies a customer may keep their books in. */
  currencies(): readonly string[] {
    return FX_CURRENCIES;
  }

  /** The conversion context for these (DONE) statements of the customer. */
  async context(
    customerId: number,
    statements: readonly FxStatementInfo[],
  ): Promise<FxContext> {
    const home = await this.home(customerId);
    const byId = new Map(statements.map((s) => [s.id, s]));
    const foreign = statements.filter((s) => (s.currency || home) !== home);
    const series = new Map<string, RateSeries>();
    if (foreign.length) {
      const days = foreign.flatMap((s) =>
        [s.periodStart, s.periodEnd].filter((d): d is Date => !!d).map(iso),
      );
      if (days.length) {
        const from = addDays(
          days.reduce((a, b) => (a < b ? a : b)),
          -LOOKBACK_DAYS,
        );
        const to = days.reduce((a, b) => (a > b ? a : b));
        const wanted = new Set(
          [home, ...foreign.map((s) => s.currency!)].filter((c) => c !== 'CAD'),
        );
        for (const c of wanted) series.set(c, await this.series(c, from, to));
      }
    }
    return new FxContext(home, byId, series);
  }

  /** One currency's published rates in [from, to], fetched from the Bank of Canada if missing. */
  private async series(
    currency: string,
    from: string,
    to: string,
  ): Promise<RateSeries> {
    const load = () =>
      this.prisma.fxRate.findMany({
        where: {
          currency,
          date: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T00:00:00Z`),
          },
        },
        select: { date: true, cadPer: true },
        orderBy: { date: 'asc' },
      });
    let rows = await load();
    const today = iso(new Date());
    // Covered when the first known rate is within the look-back and the last is near the
    // end of the range (or yesterday's, for a period that has not ended yet).
    const end = to < today ? to : addDays(today, -1);
    const covered =
      rows.length > 0 &&
      iso(rows[0].date) <= addDays(from, LOOKBACK_DAYS) &&
      iso(rows[rows.length - 1].date) >= addDays(end, -5);
    const key = `${currency}:${from}:${to}`;
    if (!covered && Date.now() - (this.tried.get(key) ?? 0) > RETRY_MS) {
      this.tried.set(key, Date.now());
      await this.fetchValet(currency, from, to);
      rows = await load();
    }
    return rows.map((r) => ({ date: iso(r.date), cadPer: Number(r.cadPer) }));
  }

  /** Never throws: no rate leaves the rows unconverted (and logged). */
  private async fetchValet(
    currency: string,
    from: string,
    to: string,
  ): Promise<void> {
    const series = `FX${currency}CAD`;
    try {
      const res = await fetch(
        `${VALET}/${series}/json?start_date=${from}&end_date=${to}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        observations?: Array<Record<string, unknown>>;
      };
      const data = (body.observations ?? []).flatMap((o) => {
        const d = typeof o.d === 'string' ? o.d : null;
        const v = (o[series] as { v?: string } | undefined)?.v;
        const n = v ? Number(v) : NaN;
        return d && Number.isFinite(n) && n > 0
          ? [
              {
                currency,
                date: new Date(`${d}T00:00:00Z`),
                cadPer: n.toFixed(8),
              },
            ]
          : [];
      });
      if (data.length) {
        await this.prisma.fxRate.createMany({ data, skipDuplicates: true });
      }
      this.logger.log(`${series} ${from}…${to}: ${data.length} rate(s)`);
    } catch (err) {
      this.logger.warn(
        `${series} ${from}…${to} not fetched: ${(err as Error).message}`,
      );
    }
  }
}
