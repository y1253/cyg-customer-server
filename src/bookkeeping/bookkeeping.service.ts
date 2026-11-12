import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  StatementStatus,
  type AttachmentKind,
  type BankStatement,
  type Prisma,
} from '@prisma/client';
import { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { readPricing } from '../billing/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  accountCurrencies,
  effectiveCurrency,
  loadOpeningStatements,
} from './opening-balance.query';
import {
  ledgerOrder,
  OPENING_POSITION,
  openingChain,
  openingRows,
  startsByAccount,
  type StartReason,
} from './opening-balance.util';
import { cents, describeCheck, type Check } from './reconcile.util';
import { statementLabel } from './statement-label';
import { statementPdf } from './statement-pdf';
import { StatementProcessorService } from './statement-processor.service';
import { StatementImagesService } from './statement-images.service';
import {
  statementProblem,
  type StatementProblem,
} from './statement-problem.util';
import { changeFeed } from '../assistant/change-feed';
import { TaxService } from './tax.service';
import { bookLabel, scopeWhere, storagePrefix, type BookScope } from './scope';
import { remainderOf, splitTotals } from './splits.util';
import type { StoredTax } from './tax.service';
import { FxService, type FxContext, type FxEntry } from './fx.service';
import { taxSplit } from './tax.util';

export interface StatementView {
  id: number;
  filename: string;
  sizeBytes: number;
  status: StatementStatus;
  error: string | null;
  /** step2 (2026-11-08): the raw failure behind `error` (FAILED only) — under "Details". */
  errorDetail: string | null;
  /**
   * step8: the checks against the bank's own figures that FAILED, in words ("Withdrawals:
   * statement $4,812.40, read $4,728.03 (off by $84.37)") — the "Details" of a statement
   * that needs review. Empty for every other statement.
   */
  checks: string[];
  /** step8: what the customer said was wrong with it (its chat); given to every re-read. */
  customerNote: string | null;
  accountName: string | null;
  /** BANK | CREDIT_CARD (null = read before it was recorded). */
  accountKind: string | null;
  /** ISO code of its amounts as READ; null = not printed (the home currency). */
  currency: string | null;
  /** What it is converted from: the customer's setting for the account, else `currency`. */
  accountCurrency: string | null;
  bankName: string | null;
  /** "Chase 4362 · Sep 2026" — what every ledger row of this statement shows. */
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  /**
   * 2026-11-11: the bank's printed balances as read (null = not read) and whether its rows
   * were checked against them — VERIFIED, UNVERIFIED (nothing printed was read to check
   * against) or MISMATCH. The AI told a caller an unchecked statement "matches the bank".
   */
  openingBalance: number | null;
  closingBalance: number | null;
  /**
   * step2 (2026-11-12): where it ends — the printed closing, else opening ± its rows (a card:
   * opening − net, the amount owed). Null when neither is known, or outside `list()`.
   */
  endingBalance?: number | null;
  verification: string | null;
  createdAt: Date;
  processedAt: Date | null;
  /** The customer filed it under this account themselves (it survives a Retry). */
  movedByCustomer: boolean;
  /** UPLOAD | SMS | WHATSAPP | EMAIL | PLAID (a month built from a connected bank — no file). */
  source: string;
  /**
   * Set when this statement STARTS its account's books (a "Starting balance" row in the
   * ledger): the first one, or one after a break in the chain. Only `list()` fills it.
   */
  startingBalance?: {
    date: string | null;
    amount: number;
    /** Why the account starts again here (absent on its first start). */
    reason?: StartReason;
  } | null;
  /**
   * step2 (2026-11-11): what is wrong with it, said plainly — its own rows don't match its
   * balance, it doesn't carry over from the previous statement, statements are missing
   * before it, or no balance could be read (`statementProblem`). Null = nothing.
   */
  problem: StatementProblem | null;
}

export interface TransactionView {
  /**
   * Unique per row, the React key: `t:<transaction>`, `s:<split>`, `o:<statement>`,
   * `x:<tax line>`.
   */
  key: string;
  /**
   * The transaction's id; for a tax row, the id of the row it taxes (a transaction or a
   * split). 0 on a starting balance.
   */
  id: number;
  /** On a split, and on a split's tax rows: the transaction it was split from. */
  splitOfId?: number;
  statementId: number;
  pendingDate: string | null;
  postingDate: string | null;
  description: string;
  /** The payee / payer the AI read out of the description; null when it found none. */
  name: string | null;
  /** On a split made for a receipt line: that line ("Pampers"). */
  itemName?: string | null;
  /**
   * step9: a one-time edit — the name the rules give this row (`ruleName`) that it is an
   * exception from. Absent = it follows the rules.
   */
  exception?: { main: string };
  amount: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
  /** The statement it came from, e.g. "Chase 4362 · Sep 2026". */
  statementLabel: string;
  /**
   * `opening`: the statement's printed starting balance, offset to Owner's Loan — never
   * stored. `tax`: an agency's tax on the row just above it (`TransactionTax`), taken OUT
   * of that row: the row above shows its amount without tax, and the two add back to what
   * the bank moved. `split`: a part the customer split off the transaction above by hand,
   * with its own name, category and taxes; the transaction shows what is left of it.
   */
  kind?: 'opening' | 'tax' | 'split' | 'fx';
  /** On a tax row: the agency's rate, a percent. */
  taxRate?: number;
  /** On a tax row: the agency — the key for renaming the line. */
  taxAgencyId?: number;
  /** On a transaction row: its receipts, cheques and voice notes. */
  attachments?: Array<{ id: number; kind: AttachmentKind; filename: string }>;
  /**
   * A row of a statement in ANOTHER currency than the customer's home one: that currency,
   * the rate of its day (null = no rate known yet) and the amount converted. `fx` rows (the
   * revaluation at a statement's end, never stored) have amount 0 and only `homeAmount`.
   */
  currency?: string;
  fxRate?: number | null;
  homeAmount?: number;
}

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/**
 * A foreign statement's rows with their rate and home amount, and the revaluation row
 * (`kind: 'fx'`) at each foreign statement's end, placed above that statement's newest row.
 */
function withFx(
  views: TransactionView[],
  ctx: FxContext,
  statements: ReadonlyMap<number, Parameters<typeof statementLabel>[0]>,
): TransactionView[] {
  const entries: FxEntry[] = [];
  const out = views.map((v) => {
    if (!ctx.isForeign(v.statementId)) return v;
    const { home, rate } = ctx.convert(
      v.statementId,
      v.postingDate ?? v.pendingDate,
      v.amount,
    );
    entries.push({
      statementId: v.statementId,
      bankAccount: v.amount < 0 ? v.creditAccount : v.debitAccount,
      amount: v.amount,
      home,
    });
    return {
      ...v,
      currency: ctx.currencyOf(v.statementId),
      fxRate: rate,
      homeAmount: home,
    };
  });
  const revalued = new Map(
    ctx.revaluations(entries).map((r) => [r.statementId, r]),
  );
  return out.flatMap((v, i): TransactionView[] => {
    const r = revalued.get(v.statementId);
    if (!r || out.findIndex((x) => x.statementId === v.statementId) !== i) {
      return [v];
    }
    const s = statements.get(r.statementId);
    return [
      {
        key: `f:${r.statementId}`,
        id: 0,
        statementId: r.statementId,
        pendingDate: null,
        postingDate: r.date,
        description: `Exchange rate on ${r.date}: ${r.rate.toFixed(4)}`,
        name: r.offsetAccount,
        amount: 0,
        offsetAccount: r.offsetAccount,
        debitAccount: r.debitAccount,
        creditAccount: r.creditAccount,
        statementLabel: s ? statementLabel(s) : '',
        kind: 'fx',
        currency: ctx.currencyOf(r.statementId),
        fxRate: r.rate,
        homeAmount: r.homeAmount,
      },
      v,
    ];
  });
}

/** A row without its tax, then one line per agency (named by the customer, or as the row). */
function withTaxLines(
  p: TransactionView,
  lines: StoredTax[] | undefined,
): TransactionView[] {
  if (!lines?.length) return [p];
  const split = taxSplit(p, lines);
  return [
    split.parent,
    ...split.taxes.map(
      (entry, i): TransactionView => ({
        ...p,
        ...entry,
        key: `x:${p.id}:${lines[i].agencyId}`,
        attachments: undefined,
        name: lines[i].name ?? p.name,
        kind: 'tax',
        taxRate: lines[i].rate,
        taxAgencyId: lines[i].agencyId,
      }),
    ),
  ];
}

/**
 * What the customer sees of a statement. Of the check against the bank's figures
 * (`verificationDetail`) only the FAILED checks of a statement that needs review are
 * returned, in words (step8 — they used to stay with us).
 */
function toView(
  s: BankStatement,
  currencies: ReadonlyMap<string, string> = new Map(),
  /** `list()` only: where the account's chain breaks at this statement. */
  extra: {
    reason?: StartReason;
    rechecked?: boolean;
    rechecking?: boolean;
    /** Σ its own rows: the ending is checked (step2, 2026-11-12) and shown. */
    net?: number;
  } = {},
): StatementView {
  const opening = s.openingBalance === null ? null : Number(s.openingBalance);
  const closing = s.closingBalance === null ? null : Number(s.closingBalance);
  return {
    id: s.id,
    filename: s.filename,
    sizeBytes: s.sizeBytes,
    status: s.status,
    error: s.error,
    errorDetail: s.status === 'FAILED' ? s.errorDetail : null,
    checks:
      s.status === 'NEEDS_REVIEW' ? failedChecks(s.verificationDetail) : [],
    customerNote: s.customerNote,
    accountName: s.accountName,
    accountKind: s.accountKind,
    currency: s.currency,
    accountCurrency: effectiveCurrency(s, currencies),
    bankName: s.bankName,
    label: statementLabel(s),
    periodStart: day(s.periodStart),
    periodEnd: day(s.periodEnd),
    transactionCount: s.transactionCount,
    openingBalance: opening,
    closingBalance: closing,
    ...(extra.net !== undefined && {
      endingBalance:
        closing ??
        balanceFit(opening, null, extra.net, s.accountKind === 'CREDIT_CARD')
          .expectedClosing,
    }),
    verification: s.verification,
    createdAt: s.createdAt,
    processedAt: s.processedAt,
    movedByCustomer: s.accountNameByCustomer !== null,
    source: s.source,
    problem: statementProblem({
      ...s,
      openingBalance: opening,
      closingBalance: closing,
      net: extra.net,
      reason: extra.reason,
      rechecked: extra.rechecked,
      rechecking: extra.rechecking,
    }),
  };
}

export interface StatementBalancesResult {
  statement: StatementView;
  /** For the AI: what to do when the balances do not prove the rows (2026-11-11). */
  advice?: string;
  /** opening ± the rows = closing, to the cent (null = a balance is missing). */
  balancesMatch: boolean | null;
  /** What opening ± the rows comes to (null = no opening). */
  expectedClosing: number | null;
}

/**
 * step2: does opening + the rows reach the closing balance? A card prints the balance
 * OWED, so its purchases (negative rows) raise it: opening − net.
 */
export function balanceFit(
  opening: number | null,
  closing: number | null,
  net: number,
  card: boolean,
): { balancesMatch: boolean | null; expectedClosing: number | null } {
  if (opening === null) return { balancesMatch: null, expectedClosing: null };
  const c = (n: number) => Math.round(n * 100);
  const expected = (c(opening) + (card ? -c(net) : c(net))) / 100;
  return {
    balancesMatch: closing === null ? null : c(expected) === c(closing),
    expectedClosing: expected,
  };
}

/**
 * The stored checks with the whole-statement "Ending balance" check re-judged from
 * `balanceFit` (dropped when a balance is missing). Pure.
 */
export function withBalanceCheck(
  detail: Prisma.JsonValue | null,
  fit: { balancesMatch: boolean | null; expectedClosing: number | null },
  closing: number | null,
): Prisma.InputJsonValue {
  const others = (Array.isArray(detail) ? detail : []).filter((c) => {
    const check = c as { name?: string; page?: number } | null;
    return !(check?.name === 'balance' && check.page == null);
  }) as Prisma.InputJsonValue[];
  if (fit.balancesMatch === null || closing === null) return others;
  const check: Check = {
    name: 'balance',
    expected: cents(closing),
    actual: cents(fit.expectedClosing ?? 0),
    ok: fit.balancesMatch,
    skipped: null,
  };
  return [...others, { ...check, text: describeCheck(check) }];
}

/** The failed (not skipped) checks' words, as the processor stored them. */
export function failedChecks(detail: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(detail)) return [];
  return detail.flatMap((c) => {
    const check = c as {
      ok?: boolean;
      skipped?: string | null;
      text?: string;
    } | null;
    return check && !check.ok && !check.skipped && check.text
      ? [check.text]
      : [];
  });
}

/**
 * One book's statements and ledger. EVERY query is scoped to the caller's book
 * (`scopeWhere`: their `customerId` AND the `companyId` it belongs to), and a statement that is not theirs answers 404 — never 403, which would
 * confirm somebody else's upload exists.
 */
/** step8: a statement's note grows; the newest words last, the oldest dropped past 4000 chars. */
export function appendNote(had: string | null, note: string): string {
  const add = note.trim();
  if (!had?.trim()) return add.slice(0, 4000);
  if (had.includes(add)) return had;
  return `${had.trim()}\n\n${add}`.slice(-4000);
}

@Injectable()
export class BookkeepingService {
  private readonly logger = new Logger(BookkeepingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly openai: OpenAiClient,
    private readonly processor: StatementProcessorService,
    private readonly tax: TaxService,
    private readonly images: StatementImagesService,
    private readonly fx: FxService,
  ) {}

  /**
   * Stores each staged PDF in R2 as UPLOADED — NOT read yet: reading starts when the
   * customer clicks Generate (`generate`). Staged files are always removed.
   */
  async upload(
    scope: BookScope,
    files: Express.Multer.File[],
  ): Promise<StatementView[]> {
    try {
      if (!files?.length)
        throw new BadRequestException('Choose at least one PDF statement');
      if (!this.storage.configured || !this.openai.configured) {
        throw new ServiceUnavailableException(
          'Statement uploads are not available right now. Please try again later.',
        );
      }
      const created: StatementView[] = [];
      for (const file of files) {
        const key = `${storagePrefix(scope)}/${randomUUID()}.pdf`;
        await this.storage.putFile(key, file.path, 'application/pdf');
        const row = await this.prisma.bankStatement.create({
          data: {
            ...scopeWhere(scope),
            filename: file.originalname.slice(0, 191),
            storageKey: key,
            sizeBytes: file.size,
          },
        });
        created.push(toView(row));
      }
      return created;
    } finally {
      await Promise.all(
        (files ?? []).map((f) => unlink(f.path).catch(() => undefined)),
      );
    }
  }

  /**
   * The customer's own `POST /bookkeeping/generate`: allowed only when it costs nothing —
   * the admin price is $0, or there are no new statements (a tax-only re-run is free).
   * A paid Generate goes through billing (`BillingService`), which calls `generate` itself
   * once the payment is recorded.
   */
  async generateIfFree(
    scope: BookScope,
  ): Promise<{ queued: number; taxing: boolean }> {
    const waiting = await this.waitingCount(scope);
    if (waiting && (await readPricing(this.prisma)).generatePriceCents > 0)
      throw new HttpException(
        'Payment required — pay to read your new statements.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    return this.generate(scope);
  }

  /** Statements uploaded but not read yet — what the next Generate would queue. */
  waitingCount(scope: BookScope): Promise<number> {
    return this.prisma.bankStatement.count({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        status: StatementStatus.UPLOADED,
      },
    });
  }

  /**
   * Generate: queue every UPLOADED statement for reading. (Tax needs no run: it is decided
   * per name on read.) `taxing` is always false, kept for the client.
   */
  async generate(
    scope: BookScope,
  ): Promise<{ queued: number; taxing: boolean }> {
    const { count } = await this.prisma.bankStatement.updateMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        status: StatementStatus.UPLOADED,
      },
      data: { status: StatementStatus.PENDING },
    });
    if (count) this.processor.processSoon();
    return { queued: count, taxing: false };
  }

  async list(scope: BookScope): Promise<StatementView[]> {
    const [rows, currencies, opening] = await Promise.all([
      this.prisma.bankStatement.findMany({
        where: { ...scopeWhere(scope), deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      accountCurrencies(this.prisma, scope),
      loadOpeningStatements(this.prisma, scope),
    ]);
    // The same rows the ledger shows as "Starting balance", so the folders agree with it.
    const starts = new Map(
      [...startsByAccount(openingChain(opening)).values()]
        .flat()
        .map((s) => [
          s.statementId,
          { date: s.date, amount: s.amount, reason: s.reason },
        ]),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const nets = new Map(
      [...opening, ...(opening.bridges ?? [])].map((o) => [o.id, o.net]),
    );
    const busy = (r?: BankStatement) =>
      r?.status === StatementStatus.PENDING ||
      r?.status === StatementStatus.PROCESSING;
    return rows.map((r) => {
      const start = starts.get(r.id);
      const reason = start?.reason;
      const previous =
        reason?.kind === 'MISMATCH'
          ? byId.get(reason.previousStatementId)
          : undefined;
      return {
        ...toView(r, currencies, {
          reason,
          net: nets.get(r.id),
          rechecked:
            r.chainRereadAt !== null && previous?.chainRereadAt != null,
          // The strong re-read of the pair is queued or running (the earlier one, or
          // this one coming back for its turn).
          rechecking:
            busy(previous) ||
            (r.chainRereadAt !== null &&
              (r.processedAt === null || r.processedAt < r.chainRereadAt)),
        }),
        startingBalance: start ?? null,
      };
    });
  }

  async transactions(
    scope: BookScope,
    statementIds?: number[],
  ): Promise<TransactionView[]> {
    const [rows, statements, taxes, attached] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: {
          ...scopeWhere(scope),
          ...(statementIds?.length && { statementId: { in: statementIds } }),
          statement: { deletedAt: null, status: StatementStatus.DONE },
        },
        include: {
          statement: {
            select: {
              accountName: true,
              bankName: true,
              filename: true,
              periodStart: true,
              periodEnd: true,
            },
          },
        },
      }),
      // ALL done statements: the chain decides which ones start fresh, even when the
      // ledger is filtered to a few of them.
      loadOpeningStatements(this.prisma, scope),
      this.tax.linesFor(scope, statementIds),
      this.prisma.transactionAttachment.findMany({
        where: {
          ...scopeWhere(scope),
          deletedAt: null,
          transactionId: { not: null },
        },
        select: { id: true, kind: true, filename: true, transactionId: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const attachmentsOf = new Map<
      number,
      Array<{ id: number; kind: AttachmentKind; filename: string }>
    >();
    for (const a of attached) {
      const list = attachmentsOf.get(a.transactionId!) ?? [];
      list.push({ id: a.id, kind: a.kind, filename: a.filename });
      attachmentsOf.set(a.transactionId!, list);
    }

    const byId = new Map(statements.map((s) => [s.id, s]));
    const totals = splitTotals(
      rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })),
    );
    const viewOf = (r: (typeof rows)[number]): TransactionView => ({
      key: r.splitOfId ? `s:${r.id}` : `t:${r.id}`,
      id: r.id,
      statementId: r.statementId,
      pendingDate: day(r.pendingDate),
      postingDate: day(r.postingDate),
      description: r.description,
      name: r.name,
      ...(r.itemName && { itemName: r.itemName }),
      ...(r.exceptionRuleId !== null &&
        r.ruleName &&
        r.ruleName.toLowerCase() !== (r.name ?? '').toLowerCase() && {
          exception: { main: r.ruleName },
        }),
      amount: remainderOf({ ...r, amount: Number(r.amount) }, totals),
      offsetAccount: r.offsetAccount,
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
      statementLabel: statementLabel(r.statement),
      ...(r.splitOfId && { splitOfId: r.splitOfId, kind: 'split' as const }),
      ...(attachmentsOf.has(r.id) && { attachments: attachmentsOf.get(r.id) }),
    });
    const splitsOf = new Map<number, TransactionView[]>();
    for (const r of rows) {
      if (!r.splitOfId) continue;
      const list = splitsOf.get(r.splitOfId) ?? [];
      list.push(viewOf(r));
      splitsOf.set(r.splitOfId, list);
    }
    for (const list of splitsOf.values()) list.sort((a, b) => a.id - b.id);
    const wanted = statementIds?.length ? new Set(statementIds) : null;
    const openings = openingRows(statements).filter(
      (o) => !wanted || wanted.has(o.statementId),
    );

    const keyed: Array<{
      postingDate: Date | null;
      statementId: number;
      position: number;
      view: TransactionView;
    }> = [
      ...rows
        .filter((r) => !r.splitOfId)
        .map((r) => ({
          postingDate: r.postingDate,
          statementId: r.statementId,
          position: r.position,
          view: viewOf(r),
        })),
      ...openings.map((o) => ({
        postingDate: o.postingDate,
        statementId: o.statementId,
        position: OPENING_POSITION,
        view: {
          key: `o:${o.statementId}`,
          id: 0,
          statementId: o.statementId,
          pendingDate: null,
          postingDate: day(o.postingDate),
          description: o.description,
          name: null,
          amount: o.amount,
          offsetAccount: o.offsetAccount,
          debitAccount: o.debitAccount,
          creditAccount: o.creditAccount,
          statementLabel: statementLabel(byId.get(o.statementId)!),
          kind: 'opening' as const,
        },
      })),
    ];
    // Newest first. A taxed row shows its amount without tax, its tax lines directly under
    // it; then its splits, each followed by its own tax lines.
    const sorted = keyed.sort((a, b) => -ledgerOrder(a, b)).map((k) => k.view);
    const views = sorted.flatMap((p): TransactionView[] =>
      p.kind
        ? [p]
        : [
            ...withTaxLines(p, taxes.get(p.id)),
            ...(splitsOf.get(p.id) ?? []).flatMap((c) =>
              withTaxLines(c, taxes.get(c.id)),
            ),
          ],
    );
    const ctx = await this.fx.context(scope, statements);
    return ctx.anyForeign ? withFx(views, ctx, byId) : views;
  }

  async file(
    scope: BookScope,
    id: number,
  ): Promise<{ stream: Readable; filename: string; size: number }> {
    const f = await this.fileInfo(scope, id);
    if (f.generated) {
      const buf = await this.feedStatementPdf(
        scope,
        await this.owned(scope, id),
      );
      return {
        stream: Readable.from(buf),
        filename: f.filename,
        size: buf.length,
      };
    }
    return {
      stream: await this.storage.getStream(f.storageKey),
      filename: f.filename,
      size: f.size,
    };
  }

  /**
   * The statement's PDF exists — checked without opening it (the assistant's links).
   * A bank-feed month (step11) has no stored file: its PDF is built on open (step12d),
   * so it answers `generated` with no size.
   */
  async fileInfo(
    scope: BookScope,
    id: number,
  ): Promise<{
    storageKey: string;
    filename: string;
    size: number;
    generated: boolean;
  }> {
    const s = await this.owned(scope, id);
    if (!s.storageKey && s.source === 'PLAID') {
      return {
        storageKey: '',
        filename: `${statementLabel(s).replace(/[\\/:*?"<>|]/g, '-')}.pdf`,
        size: 0,
        generated: true,
      };
    }
    if (!s.storageKey)
      throw new NotFoundException('There is no PDF of this statement');
    const info = await this.storage.head(s.storageKey);
    if (!info)
      throw new NotFoundException(
        'The original PDF of this statement is no longer stored',
      );
    return {
      storageKey: s.storageKey,
      filename: s.filename,
      size: info.size,
      generated: false,
    };
  }

  /** step12d: a bank-feed month as a statement-like PDF, from its own parent rows. */
  private async feedStatementPdf(
    scope: BookScope,
    s: BankStatement,
  ): Promise<Buffer> {
    const [rows, book, currencies] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), statementId: s.id, splitOfId: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          postingDate: true,
          pendingDate: true,
          name: true,
          description: true,
          amount: true,
        },
      }),
      this.prisma.book.findUnique({
        where: { id: scope.bookId },
        select: { name: true },
      }),
      accountCurrencies(this.prisma, scope),
    ]);
    const num = (v: unknown) =>
      v === null || v === undefined ? null : Number(v);
    return statementPdf({
      title: statementLabel(s),
      bankName: s.bankName,
      accountName: s.accountName,
      owner: book?.name ?? '',
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      currency: effectiveCurrency(s, currencies),
      creditCard: s.accountKind === 'CREDIT_CARD',
      opening: num(s.openingBalance),
      closing: num(s.closingBalance),
      rows: rows.map((r) => ({
        postingDate: r.postingDate,
        pendingDate: r.pendingDate,
        name: r.name,
        description: r.description,
        amount: Number(r.amount),
      })),
    });
  }

  /**
   * Read a statement again. `note` (step8: what the customer said was wrong with it, from
   * its chat) is kept on the statement and given to this and every later re-read; an
   * empty note clears it, no note leaves it as it is. step2 (2026-11-08): a statement that
   * was read (DONE) can be read again too — its receipts are put back on the same
   * transactions afterwards (`StatementProcessorService.relinkReceipts`). Never a bank-feed
   * month (no file; the bank's own data).
   */
  async retry(
    scope: BookScope,
    id: number,
    note?: string,
    /** step8: add the note after the one the statement has (the AI's re-reads), not replace it. */
    opts: { append?: boolean } = {},
  ): Promise<StatementView> {
    const s = await this.owned(scope, id);
    if (s.source === 'PLAID') {
      throw new BadRequestException(
        'A bank-feed month comes straight from the bank — it cannot be read again',
      );
    }
    if (
      s.status !== StatementStatus.FAILED &&
      s.status !== StatementStatus.NEEDS_REVIEW &&
      s.status !== StatementStatus.DONE
    ) {
      throw new BadRequestException(
        'This statement is still waiting or being read',
      );
    }
    // A fresh set of full reads: "re-read until it matches" starts over.
    const row = await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: {
        status: StatementStatus.PENDING,
        attempts: 0,
        runs: 0,
        error: null,
        errorDetail: null,
        ...(note === undefined
          ? {}
          : {
              customerNote:
                (opts.append && note.trim()
                  ? appendNote(s.customerNote, note)
                  : note.trim().slice(0, 4000)) || null,
            }),
      },
    });
    this.processor.processSoon();
    return toView(row);
  }

  /**
   * 2026-11-11 (user's request): "Re-read all" under the Problems filter. Every statement
   * with a problem that a re-read can fix, each through `retry` (same rules). Never a
   * bank-feed month, nor one whose only problem is a MISSING gap — only uploading the
   * missing statement fixes that.
   */
  async retryProblems(scope: BookScope): Promise<{ queued: number }> {
    const all = await this.list(scope);
    let queued = 0;
    for (const s of all.filter(rereadable)) {
      try {
        await this.retry(scope, s.id);
        queued++;
      } catch {
        // Picked up or changed meanwhile — leave it.
      }
    }
    if (queued) changeFeed.bump(scope.customerId);
    return { queued };
  }

  /**
   * step8 (2026-11-11): "fix every CIBC 7522 statement" — the statement itself plus every
   * other FAILED / NEEDS_REVIEW (or DONE but UNVERIFIED) uploaded statement of the same
   * account (folder) in this book.
   */
  async sameAccountToRetry(scope: BookScope, id: number): Promise<number[]> {
    const s = await this.owned(scope, id);
    const account = s.accountNameByCustomer ?? s.accountName;
    if (!account) return [s.id];
    const others = await this.prisma.bankStatement.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        id: { not: s.id },
        source: { not: 'PLAID' },
        AND: [
          {
            // 2026-11-11: a DONE statement whose rows were never checked (UNVERIFIED) is as
            // suspect as a failed one — Madam recovery's Chase 4148 months were all wrong.
            OR: [
              {
                status: {
                  in: [StatementStatus.FAILED, StatementStatus.NEEDS_REVIEW],
                },
              },
              { status: StatementStatus.DONE, verification: 'UNVERIFIED' },
            ],
          },
          {
            OR: [
              { accountNameByCustomer: account },
              { accountNameByCustomer: null, accountName: account },
            ],
          },
        ],
      },
      select: { id: true },
      orderBy: { periodStart: 'asc' },
    });
    return [s.id, ...others.map((o) => o.id)];
  }

  /**
   * step2 (2026-11-08): the customer says a read statement's opening / closing balance is
   * wrong and gives the right one (its chat or a call). Written as printed (a card: the
   * balance OWED); the starting-balance rows and chains are computed on read, so the books
   * follow at once. The reason is added to `customerNote`, so a later re-read keeps it.
   * Answers whether opening + the rows now reach the closing balance.
   */
  async setBalances(
    scope: BookScope,
    id: number,
    input: {
      openingBalance?: number | null;
      closingBalance?: number | null;
      reason: string;
    },
  ): Promise<StatementBalancesResult> {
    const s = await this.owned(scope, id);
    if (s.source === 'PLAID') {
      throw new BadRequestException(
        "A bank-feed month's balances come from the bank itself and cannot be changed. If they look wrong, check the account's start date or reconnect the bank.",
      );
    }
    if (s.status !== StatementStatus.DONE) {
      throw new BadRequestException(
        'Only a statement that was read can have its balances set — read it again with retry_statement and a note instead',
      );
    }
    const money = (n: number | null | undefined) =>
      n === undefined ? undefined : n === null ? null : n.toFixed(2);
    const opening = money(input.openingBalance);
    const closing = money(input.closingBalance);
    if (opening === undefined && closing === undefined) {
      throw new BadRequestException('Give the opening or the closing balance');
    }
    const words = [
      opening !== undefined
        ? `opening balance is ${opening ?? 'not printed'}`
        : '',
      closing !== undefined
        ? `closing balance is ${closing ?? 'not printed'}`
        : '',
    ]
      .filter(Boolean)
      .join(' and ');
    const line = `The ${words} (customer: ${input.reason.trim().slice(0, 500)})`;
    const customerNote = [s.customerNote?.trim(), line]
      .filter(Boolean)
      .join('\n')
      .slice(-4000);
    const row = await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: {
        ...(opening === undefined ? {} : { openingBalance: opening }),
        ...(closing === undefined ? {} : { closingBalance: closing }),
        customerNote,
      },
    });
    const sum = await this.prisma.bankTransaction.aggregate({
      where: { statementId: s.id, splitOfId: null },
      _sum: { amount: true },
    });
    const fit = balanceFit(
      row.openingBalance === null ? null : Number(row.openingBalance),
      row.closingBalance === null ? null : Number(row.closingBalance),
      Number(sum._sum.amount ?? 0),
      row.accountKind === 'CREDIT_CARD',
    );
    // 2026-11-11: the stored "Ending balance ✓" is re-judged with the new figures — #317
    // kept its tick after the AI set an opening the statement does not print.
    const checked = await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: {
        verificationDetail: withBalanceCheck(
          row.verificationDetail,
          fit,
          row.closingBalance === null ? null : Number(row.closingBalance),
        ),
      },
    });
    return {
      statement: toView(checked, undefined, {
        net: Number(sum._sum.amount ?? 0),
      }),
      ...fit,
      ...(fit.balancesMatch !== true && {
        advice:
          fit.balancesMatch === false
            ? `Opening ± this statement's transactions comes to ${fit.expectedClosing?.toFixed(2)}, not the closing balance — the transactions themselves were read wrong. Tell the customer, and read it again with retry_statement (a note quoting the printed balances) instead of setting more balances.`
            : 'Its opening or closing balance is still unknown, so its transactions are NOT checked. Read it again with retry_statement (a note quoting the printed balances) so they are.',
      }),
    };
  }

  /**
   * Soft delete: its rows leave the ledger at once, and the cheque images cut out of it
   * leave the Receipts tab; the PDF stays in R2.
   */
  async remove(scope: BookScope, id: number): Promise<void> {
    const s = await this.owned(scope, id);
    await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: { deletedAt: new Date() },
    });
    await this.images.removeFor(scope, s.id);
    // step2: its neighbours may no longer carry over.
    await this.processor.recheckChains(scope, [s.accountName]);
  }

  /**
   * File a statement under another account — the customer dragged it into that folder.
   * An account IS its name everywhere downstream, so this rewrites the statement's name
   * and the bank side of each of its rows (`doubleEntry`: credit when the amount is
   * negative, else debit — never the offset, which may share the old name). Opening
   * balances chain on read, so they follow by themselves. `accountNameByCustomer`
   * makes it stick through a Retry.
   */
  async moveStatement(
    scope: BookScope,
    id: number,
    rawName: string,
  ): Promise<StatementView> {
    const s = await this.owned(scope, id);
    if (
      s.status !== StatementStatus.DONE &&
      s.status !== StatementStatus.NEEDS_REVIEW
    ) {
      throw new BadRequestException(
        'Only a statement that has been read can be moved',
      );
    }
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 191) {
      throw new BadRequestException('Enter an account name');
    }
    const old = s.accountName;
    if (name === old) return toView(s);

    // Joining an existing account takes its kind: a card folder stays a card.
    const target = await this.prisma.bankStatement.findFirst({
      where: {
        ...scopeWhere(scope),
        accountName: name,
        deletedAt: null,
        id: { not: s.id },
      },
      select: { accountKind: true },
    });

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.bankTransaction.updateMany({
        where: { statementId: s.id, amount: { lt: 0 } },
        data: { creditAccount: name },
      });
      await tx.bankTransaction.updateMany({
        where: { statementId: s.id, amount: { gte: 0 } },
        data: { debitAccount: name },
      });
      const updated = await tx.bankStatement.update({
        where: { id: s.id },
        data: {
          accountName: name,
          accountNameByCustomer: name,
          accountKind: target ? target.accountKind : s.accountKind,
        },
      });
      // The old account's section override goes with its LAST statement.
      if (old) {
        const left = await tx.bankStatement.count({
          where: { ...scopeWhere(scope), accountName: old, deletedAt: null },
        });
        if (left === 0) {
          const kept = await tx.customerAccountType.findFirst({
            where: { ...scopeWhere(scope), account: name },
          });
          if (kept) {
            await tx.customerAccountType.deleteMany({
              where: { ...scopeWhere(scope), account: old },
            });
          } else {
            await tx.customerAccountType.updateMany({
              where: { ...scopeWhere(scope), account: old },
              data: { account: name },
            });
          }
          // So does its currency setting (the target's own setting wins).
          const keptCurrency = await tx.customerAccountCurrency.findFirst({
            where: { ...scopeWhere(scope), account: name },
          });
          if (keptCurrency) {
            await tx.customerAccountCurrency.deleteMany({
              where: { ...scopeWhere(scope), account: old },
            });
          } else {
            await tx.customerAccountCurrency.updateMany({
              where: { ...scopeWhere(scope), account: old },
              data: { account: name },
            });
          }
        }
      }
      return updated;
    });
    this.logger.log(
      `${bookLabel(scope)}: statement #${s.id} moved "${old}" -> "${name}"`,
    );
    // step2 (2026-11-11): both folders' chains changed — every open page refreshes, and a
    // balance that no longer carries over in either one is re-read on the strong model.
    changeFeed.bump(scope.customerId);
    await this.processor.recheckChains(scope, [old, name]);
    return toView(row);
  }

  private async owned(scope: BookScope, id: number): Promise<BankStatement> {
    const s = await this.prisma.bankStatement.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!s) throw new NotFoundException('Statement not found');
    return s;
  }
}

/** A problem statement "Re-read all" takes (`retryProblems`). Pure; the client has a twin. */
export function rereadable(
  s: Pick<StatementView, 'status' | 'source' | 'problem'>,
): boolean {
  if (s.source === 'PLAID') return false;
  if (s.status === 'FAILED' || s.status === 'NEEDS_REVIEW') return true;
  return s.status === 'DONE' && !!s.problem && s.problem.kind !== 'MISSING';
}
