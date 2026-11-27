import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { typeFor, type TypeContext } from '../bookkeeping/chart-of-accounts';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { TaxService } from '../bookkeeping/tax.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  familyHash,
  familyLines,
  qboAccountType,
  qboBody,
  qboCategoryName,
  qboPayeeName,
  qboQuote,
  qboText,
  qboTypeOf,
  repointEntity,
  type QboBodyOmit,
  type QboFamily,
  type QboFieldValue,
  type QboRefs,
} from './qbo-mapping.util';
import {
  acceptMatch,
  candidatesFor,
  verifyMatch,
  type DatedCents,
  type QboBankAccount,
} from './qbo-bank-match.util';
import { QboCallError, QboSystemClient } from './qbo-system.client';

/** At most this many QuickBooks writes per book per run — the next run takes the rest. */
const MAX_PER_RUN = 150;
/** QuickBooks transactions read per query when a name merge moves a payee's history. */
const MERGE_PAGE = 200;
const DEBOUNCE_MS = 2_000;
/** step11 part 3: how far back a bank account's transactions are compared (days). */
const MATCH_DAYS = 90;
/** QuickBooks transactions read per query for that comparison (its maximum). */
const MATCH_PAGE = 1000;

type EntityType = 'Vendor' | 'Customer' | 'Employee';

/** Thrown to stop a book's run: QuickBooks is off or needs a reconnect (409 / 404). */
class StopRun extends Error {}

const ROW_SELECT = {
  id: true,
  externalId: true,
  amount: true,
  postingDate: true,
  pendingDate: true,
  description: true,
  name: true,
  subNameId: true,
  offsetAccount: true,
  qboId: true,
  qboType: true,
  qboHash: true,
  statement: {
    select: {
      plaidAccount: {
        select: { id: true, kind: true, accountName: true, qboAccountId: true },
      },
    },
  },
  splits: {
    select: {
      id: true,
      amount: true,
      offsetAccount: true,
      name: true,
      subNameId: true,
    },
  },
} satisfies Prisma.BankTransactionSelect;

type Row = Prisma.BankTransactionGetPayload<{ select: typeof ROW_SELECT }>;

/** What one run of a book has looked up in QuickBooks already. */
interface RunCache {
  accounts: Map<string, string>;
  entities: Map<string, { id: string; type: EntityType } | null>;
  types: TypeContext;
  /** step11 part 3: class name → QuickBooks Class id (null = none could be found / made). */
  classes: Map<string, string | null>;
  /** step11 part 3: QuickBooks' Bank + Credit Card accounts (read once a run). */
  bankAccounts?: QboBankAccount[];
  /** QuickBooks transactions of the last MATCH_DAYS, by their bank account id. */
  recent?: Map<string, DatedCents[]>;
}

/** step11 part 3: the answers of the book's QuickBooks-linked columns, per transaction id. */
interface LinkedAnswers {
  classOf: Map<number, string>;
  fieldsOf: Map<number, QboFieldValue[]>;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * step11 (internal, 2026-11-23): pushes a company's bank-feed transactions to its QuickBooks
 * file while an ADMIN has turned it on (`QuickBooksAccount.updateQuickbooks`, the moment it
 * was turned on). Only the customer API writes these rows, so it is the one that keeps
 * QuickBooks in step:
 * - a NEW Plaid row (created since the switch) → a Purchase / Deposit with its splits as
 *   lines, the payee as vendor / customer, the category as the account (made if missing);
 * - a pushed row whose name / category / splits / amount changed (`qboHash`) → updated;
 * - a pushed row whose statement was deleted, or that the bank took back → deleted there.
 * Triggered right after new rows are categorized and after a staff edit (`syncSoon`); a
 * cron every 2 minutes catches every other edit path (rules, merges, renames).
 */
@Injectable()
export class QuickBooksSyncService {
  private readonly logger = new Logger(QuickBooksSyncService.name);
  private readonly running = new Map<number, Promise<void>>();
  private readonly again = new Set<number>();
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: QboSystemClient,
    private readonly tax: TaxService,
  ) {}

  /** Push this book soon (debounced). Never throws. */
  syncSoon(bookId: number): void {
    clearTimeout(this.timers.get(bookId));
    this.timers.set(
      bookId,
      setTimeout(() => {
        this.timers.delete(bookId);
        void this.sync(bookId).catch(() => undefined);
      }, DEBOUNCE_MS),
    );
  }

  @Cron('30 */2 * * * *')
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const on = await this.prisma.quickBooksAccount.findMany({
        where: { updateQuickbooks: { not: null }, lastError: null },
        select: { companyId: true },
      });
      if (!on.length) return;
      const books = await this.prisma.book.findMany({
        where: {
          companyId: { in: on.map((o) => o.companyId) },
          deletedAt: null,
        },
        select: { id: true },
      });
      for (const b of books) await this.sync(b.id).catch(() => undefined);
    } finally {
      this.sweeping = false;
    }
  }

  /** One run per book at a time; a call during a run makes it run once more. */
  async sync(bookId: number): Promise<void> {
    const current = this.running.get(bookId);
    if (current) {
      this.again.add(bookId);
      return current;
    }
    const run = (async () => {
      try {
        do {
          this.again.delete(bookId);
          await this.runBook(bookId);
        } while (this.again.has(bookId));
      } catch (err) {
        this.logger.warn(
          `book #${bookId}: QuickBooks push failed: ${String(err)}`,
        );
      } finally {
        this.running.delete(bookId);
      }
    })();
    this.running.set(bookId, run);
    return run;
  }

  /**
   * Rows about to be hard-deleted (the bank took them back, a feed month an upload now
   * covers, an account no longer shared): their QuickBooks transactions are deleted too,
   * in the background. Call BEFORE the delete. Never throws.
   */
  async forgetRows(where: Prisma.BankTransactionWhereInput): Promise<void> {
    try {
      const rows = await this.prisma.bankTransaction.findMany({
        where: { ...where, qboId: { not: null }, companyId: { not: null } },
        select: { companyId: true, qboId: true, qboType: true },
      });
      for (const r of rows) {
        void this.client
          .remove(
            r.companyId!,
            r.qboType === 'Deposit' ? 'Deposit' : 'Purchase',
            r.qboId!,
          )
          .catch((err) =>
            this.logger.warn(
              `company #${r.companyId}: QuickBooks ${r.qboType} ${r.qboId} not removed: ${String(err)}`,
            ),
          );
      }
    } catch (err) {
      this.logger.warn(`forgetRows failed: ${String(err)}`);
    }
  }

  // ── step11.md (2026-11-25): a payee renamed in our books is renamed in QuickBooks ──

  /**
   * The name a payee's rows were last pushed under, before a NAME rule for `matchKey`
   * renames them: the rule's current name (an earlier rename), else the key itself. Read it
   * BEFORE the rule is saved. null = nothing of it was pushed yet (nothing to rename there).
   */
  async pushedPayee(
    scope: BookScope,
    matchKey: string,
  ): Promise<string | null> {
    try {
      const key = matchKey.trim().toLowerCase();
      if (!key || !scope.companyId) return null;
      const rule = await this.prisma.customerNameRule.findFirst({
        where: { ...scopeWhere(scope), matchType: 'NAME', matchKey: key },
        select: { name: true },
      });
      const names = [key, ...(rule?.name ? [rule.name] : [])];
      const row = await this.prisma.bankTransaction.findFirst({
        where: {
          ...scopeWhere(scope),
          splitOfId: null,
          qboId: { not: null },
          name: { in: names },
        },
        select: { name: true },
        orderBy: { qboSyncedAt: 'desc' },
      });
      return row?.name ?? null;
    } catch (err) {
      this.logger.warn(`pushedPayee failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Renames the payee in QuickBooks (its Vendor / Customer / Employee DisplayName) and pushes
   * the book's rows now. When QuickBooks already has a payee called `to`, nothing is renamed
   * — the push then moves the rows onto it. Runs in the background; never throws.
   */
  renamePayee(scope: BookScope, from: string | null, to: string | null): void {
    if (!from || !to || !scope.companyId) return;
    if (from.trim() === to.trim()) return;
    void this.renameNow(scope.bookId, scope.companyId, from, to)
      .catch((err) =>
        this.logger.warn(
          `book #${scope.bookId}: QuickBooks rename "${from}" → "${to}" failed: ${String(err)}`,
        ),
      )
      .finally(() => this.syncSoon(scope.bookId));
  }

  private async renameNow(
    bookId: number,
    companyId: number,
    from: string,
    to: string,
  ): Promise<void> {
    const qbo = await this.prisma.quickBooksAccount.findUnique({
      where: { companyId },
      select: { updateQuickbooks: true, lastError: true },
    });
    if (!qbo?.updateQuickbooks || qbo.lastError) return;
    // The plain name and its "-mix" form: whichever QuickBooks has is renamed.
    for (const mixed of [false, true]) {
      const oldName = qboPayeeName(from, mixed);
      const newName = qboPayeeName(to, mixed);
      if (oldName === newName) continue;
      const found = await this.findEntity(companyId, oldName);
      if (!found) continue;
      const taken = await this.findEntity(companyId, newName);
      // (QuickBooks compares names without case: "walmart" → "Walmart" finds itself.)
      if (taken && taken.id !== found.id) {
        this.logger.log(
          `book #${bookId}: QuickBooks already has "${newName}" — the rows move onto it`,
        );
        continue;
      }
      await this.client.update(companyId, found.type, found.id, {
        DisplayName: newName,
      });
      this.logger.log(
        `book #${bookId}: renamed QuickBooks ${found.type} ${found.id} "${oldName}" → "${newName}"`,
      );
    }
  }

  private async findEntity(
    companyId: number,
    name: string,
  ): Promise<{ id: string; type: EntityType } | null> {
    for (const type of ['Vendor', 'Customer', 'Employee'] as const) {
      const id = await this.findOne(
        companyId,
        type,
        `DisplayName = ${qboQuote(name)}`,
      );
      if (id) return { id, type };
    }
    return null;
  }

  // ── step11 part 2 (2026-11-26): a name merged in our books is merged in QuickBooks ──

  /**
   * After `from` was merged into `into` (Names tab drag, the customer's or staff's): the
   * QuickBooks payee our rows of `from` were pushed under is merged into `into`'s. No payee
   * called `into` there → the old one is simply renamed. Otherwise every Purchase / Deposit
   * of the old payee (not only ours — user's decision: a full merge) is moved onto the
   * target and the old payee is made inactive. Then the book's rows are pushed. Runs in the
   * background; never throws; only while the push is on.
   */
  mergePayee(scope: BookScope, from: string | null, into: string | null): void {
    if (!scope.companyId) return;
    const companyId = scope.companyId;
    if (
      !from ||
      !into ||
      from.trim().toLowerCase() === into.trim().toLowerCase()
    ) {
      this.syncSoon(scope.bookId);
      return;
    }
    void this.mergeNow(scope.bookId, companyId, from, into)
      .catch((err) =>
        this.logger.warn(
          `book #${scope.bookId}: QuickBooks merge "${from}" → "${into}" failed: ${String(err)}`,
        ),
      )
      .finally(() => this.syncSoon(scope.bookId));
  }

  private async mergeNow(
    bookId: number,
    companyId: number,
    from: string,
    into: string,
  ): Promise<void> {
    const qbo = await this.prisma.quickBooksAccount.findUnique({
      where: { companyId },
      select: { updateQuickbooks: true, lastError: true },
    });
    if (!qbo?.updateQuickbooks || qbo.lastError) return;
    for (const mixed of [false, true]) {
      const oldName = qboPayeeName(from, mixed);
      const found = await this.findEntity(companyId, oldName);
      if (!found) continue;
      const target =
        (await this.findEntity(companyId, qboPayeeName(into, mixed))) ??
        (await this.findEntity(companyId, qboPayeeName(into, !mixed)));
      if (!target) {
        const newName = qboPayeeName(into, mixed);
        await this.client.update(companyId, found.type, found.id, {
          DisplayName: newName,
        });
        this.logger.log(
          `book #${bookId}: merge renamed QuickBooks ${found.type} ${found.id} "${oldName}" → "${newName}"`,
        );
        continue;
      }
      if (target.id === found.id && target.type === found.type) continue;
      const moved = await this.repointAll(companyId, found, target);
      try {
        await this.client.update(companyId, found.type, found.id, {
          Active: false,
        });
      } catch (err) {
        this.logger.warn(
          `book #${bookId}: could not make QuickBooks ${found.type} ${found.id} inactive: ${String(err)}`,
        );
      }
      this.logger.log(
        `book #${bookId}: merged QuickBooks ${found.type} ${found.id} "${oldName}" into ${target.type} ${target.id} (${moved} transaction(s) moved)`,
      );
    }
  }

  /** Every Purchase / Deposit naming `from`, re-pointed at `to`. Each failure is logged. */
  private async repointAll(
    companyId: number,
    from: { id: string; type: EntityType },
    to: { id: string; type: EntityType },
  ): Promise<number> {
    let moved = 0;
    for (const type of ['Purchase', 'Deposit'] as const) {
      for (let start = 1; ; start += MERGE_PAGE) {
        const res = await this.client.query<Record<string, unknown>>(
          companyId,
          `select * from ${type} STARTPOSITION ${start} MAXRESULTS ${MERGE_PAGE}`,
        );
        const list =
          (res[type] as Array<Record<string, unknown>> | undefined) ?? [];
        for (const txn of list) {
          const body = repointEntity(type, txn, from.id, to);
          const id = typeof txn.Id === 'string' ? txn.Id : null;
          if (!body || !id) continue;
          try {
            await this.client.update(companyId, type, id, body);
            moved++;
          } catch (err) {
            this.stopOn(err);
            this.logger.warn(
              `company #${companyId}: could not move QuickBooks ${type} ${id} to ${to.type} ${to.id}: ${String(err)}`,
            );
          }
        }
        if (list.length < MERGE_PAGE) break;
      }
    }
    return moved;
  }

  // ── A book's run ─────────────────────────────────────────────────────────

  private async runBook(bookId: number): Promise<void> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      select: { customerId: true, companyId: true, deletedAt: true },
    });
    if (!book?.companyId || book.deletedAt) return;
    const companyId = book.companyId;
    const qbo = await this.prisma.quickBooksAccount.findUnique({
      where: { companyId },
      select: { updateQuickbooks: true, lastError: true },
    });
    if (!qbo?.updateQuickbooks || qbo.lastError) return;
    const scope: BookScope = { customerId: book.customerId, bookId, companyId };

    let writes = 0;
    try {
      writes += await this.removeOrphans(bookId, companyId);
      const rows = await this.prisma.bankTransaction.findMany({
        where: {
          bookId,
          splitOfId: null,
          externalId: { not: null },
          statement: { source: 'PLAID', status: 'DONE', deletedAt: null },
          OR: [
            { qboId: { not: null } },
            { createdAt: { gte: qbo.updateQuickbooks } },
          ],
        },
        select: ROW_SELECT,
        orderBy: { id: 'asc' },
      });
      const subNames = await this.subNamesOf(rows);
      const mixed = await this.mixedNames(bookId);
      const linked = await this.linkedAnswers(bookId, rows);
      let cache: RunCache | null = null;
      for (const row of rows) {
        if (writes >= MAX_PER_RUN) {
          this.again.add(bookId);
          break;
        }
        const family = this.familyOf(row, subNames, mixed, linked);
        if (!family) continue;
        const hash = familyHash(family);
        if (row.qboId && row.qboHash === hash) continue;
        cache ??= {
          accounts: new Map(),
          entities: new Map(),
          types: await this.tax.typeContext(scope),
          classes: new Map(),
        };
        writes++;
        await this.push(companyId, scope, row, family, hash, cache);
      }
    } catch (err) {
      if (err instanceof StopRun) return;
      throw err;
    }
    if (writes) {
      this.logger.log(
        `book #${bookId} (company #${companyId}): ${writes} QuickBooks write(s)`,
      );
    }
  }

  /** A pushed row whose statement was deleted leaves QuickBooks too. */
  private async removeOrphans(
    bookId: number,
    companyId: number,
  ): Promise<number> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        bookId,
        qboId: { not: null },
        OR: [
          { statement: { deletedAt: { not: null } } },
          { statement: { status: { not: 'DONE' } } },
        ],
      },
      select: { id: true, qboId: true, qboType: true },
      take: MAX_PER_RUN,
    });
    for (const r of rows) {
      try {
        await this.client.remove(
          companyId,
          r.qboType === 'Deposit' ? 'Deposit' : 'Purchase',
          r.qboId!,
        );
      } catch (err) {
        this.stopOn(err);
        if (!this.isNotFound(err)) {
          await this.fail(r.id, err);
          continue;
        }
      }
      await this.prisma.bankTransaction.update({
        where: { id: r.id },
        data: {
          qboId: null,
          qboType: null,
          qboHash: null,
          qboSyncedAt: null,
          qboError: null,
        },
      });
    }
    return rows.length;
  }

  private async subNamesOf(rows: Row[]): Promise<Map<number, string>> {
    const ids = new Set<number>();
    for (const r of rows) {
      if (r.subNameId) ids.add(r.subNameId);
      for (const s of r.splits) if (s.subNameId) ids.add(s.subNameId);
    }
    if (!ids.size) return new Map();
    const found = await this.prisma.subName.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(found.map((s) => [s.id, s.name]));
  }

  /**
   * step11.md (2026-11-25): the book's names (lower-cased) whose transactions sit under
   * sub-names of two or more categories — pushed as "<name>-mix" (`qboPayeeName`).
   */
  private async mixedNames(bookId: number): Promise<Set<string>> {
    const groups = await this.prisma.bankTransaction.groupBy({
      by: ['name', 'offsetAccount'],
      where: {
        bookId,
        splitOfId: null,
        subNameId: { not: null },
        name: { not: null },
      },
    });
    const categories = new Map<string, Set<string>>();
    for (const g of groups) {
      const key = g.name!.trim().toLowerCase();
      const set = categories.get(key) ?? new Set<string>();
      set.add(g.offsetAccount);
      categories.set(key, set);
    }
    return new Set(
      [...categories].filter(([, c]) => c.size > 1).map(([k]) => k),
    );
  }

  /**
   * step11 part 3: the answers of the book's columns linked to QuickBooks (a CLASS dropdown,
   * FIELD columns) for these rows and their splits. No linked column = nothing read.
   */
  private async linkedAnswers(
    bookId: number,
    rows: readonly Row[],
  ): Promise<LinkedAnswers> {
    const out: LinkedAnswers = { classOf: new Map(), fieldsOf: new Map() };
    if (!rows.length) return out;
    const columns = await this.prisma.customColumn.findMany({
      where: { bookId, deletedAt: null, qboKind: { not: null } },
      select: { id: true, qboKind: true, qboRef: true },
    });
    if (!columns.length) return out;
    const byId = new Map(columns.map((c) => [c.id, c]));
    const ids = rows.flatMap((r) => [r.id, ...r.splits.map((s) => s.id)]);
    for (let i = 0; i < ids.length; i += 1000) {
      const answers = await this.prisma.customColumnAnswer.findMany({
        where: {
          customColumnId: { in: [...byId.keys()] },
          transactionId: { in: ids.slice(i, i + 1000) },
        },
        select: {
          customColumnId: true,
          transactionId: true,
          value: true,
          dropDown: { select: { label: true, deletedAt: true } },
        },
      });
      for (const a of answers) {
        const col = byId.get(a.customColumnId);
        if (!col) continue;
        const value = (
          a.dropDown && !a.dropDown.deletedAt
            ? a.dropDown.label
            : (a.value ?? '')
        ).trim();
        if (!value) continue;
        if (col.qboKind === 'CLASS') {
          out.classOf.set(a.transactionId, value);
        } else if (col.qboKind === 'FIELD' && col.qboRef) {
          const list = out.fieldsOf.get(a.transactionId) ?? [];
          list.push({ ref: col.qboRef, value });
          out.fieldsOf.set(a.transactionId, list);
        }
      }
    }
    for (const list of out.fieldsOf.values())
      list.sort((x, y) => x.ref.localeCompare(y.ref));
    return out;
  }

  private familyOf(
    row: Row,
    subNames: ReadonlyMap<number, string>,
    mixed: ReadonlySet<string>,
    linked: LinkedAnswers = { classOf: new Map(), fieldsOf: new Map() },
  ): QboFamily | null {
    const account = row.statement.plaidAccount;
    const date = row.postingDate ?? row.pendingDate;
    const amount = Number(row.amount);
    if (!account || !date || !row.externalId || !amount) return null;
    const label = (subNameId: number | null, name: string | null) =>
      (subNameId ? subNames.get(subNameId) : null) ??
      (name && name !== row.name ? name : null);
    return {
      rowId: row.id,
      externalId: row.externalId,
      date: day(date),
      cents: Math.round(amount * 100),
      name: row.name
        ? qboPayeeName(row.name, mixed.has(row.name.trim().toLowerCase())) ||
          null
        : null,
      description: row.description,
      kind: account.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
      plaidAccountId: account.id,
      lines: familyLines(
        {
          amount,
          category: row.offsetAccount,
          description: label(row.subNameId, null),
          className: linked.classOf.get(row.id) ?? null,
        },
        row.splits.map((s) => ({
          amount: Number(s.amount),
          category: s.offsetAccount,
          description: label(s.subNameId, s.name),
          className: linked.classOf.get(s.id) ?? null,
        })),
      ),
      ...(linked.fieldsOf.get(row.id)?.length
        ? { fields: linked.fieldsOf.get(row.id) }
        : {}),
    };
  }

  /** Creates or updates the row's QuickBooks transaction; a failure is kept on the row. */
  private async push(
    companyId: number,
    scope: BookScope,
    row: Row,
    family: QboFamily,
    hash: string,
    cache: RunCache,
  ): Promise<void> {
    const type = qboTypeOf(family);
    try {
      const refs = await this.refsFor(companyId, scope, row, family, cache);
      let id = row.qboId;
      if (id && row.qboType !== type) {
        await this.removeQuietly(companyId, row.qboType, id);
        id = null;
      }
      // step11 part 3: a file whose plan takes no custom fields on expenses, or with class
      // tracking off, refuses the write — it is sent again without them (and logged).
      const omit: QboBodyOmit = {};
      const hasClass = !!refs.classIds?.size;
      for (;;) {
        try {
          id = await this.write(
            companyId,
            type,
            id,
            qboBody(family, refs, omit),
          );
          break;
        } catch (err) {
          this.stopOn(err);
          const message = err instanceof Error ? err.message : String(err);
          if (
            !omit.fields &&
            family.fields?.length &&
            /custom ?field/i.test(message)
          ) {
            omit.fields = true;
          } else if (!omit.classes && hasClass && /class/i.test(message)) {
            omit.classes = true;
          } else {
            throw err;
          }
          this.logger.warn(
            `row #${row.id}: QuickBooks refused part of it (${message}) — sending it without the ${omit.classes ? 'class' : 'custom fields'}`,
          );
        }
      }
      await this.prisma.bankTransaction.update({
        where: { id: row.id },
        data: {
          qboId: id,
          qboType: type,
          qboHash: hash,
          qboSyncedAt: new Date(),
          qboError: null,
        },
      });
    } catch (err) {
      this.stopOn(err);
      await this.fail(row.id, err);
    }
  }

  /** Updates the QuickBooks transaction, or creates it (again); answers its id. */
  private async write(
    companyId: number,
    type: 'Purchase' | 'Deposit',
    id: string | null,
    body: Record<string, unknown>,
  ): Promise<string> {
    if (id) {
      try {
        await this.client.update(companyId, type, id, body);
        return id;
      } catch (err) {
        this.stopOn(err);
        if (!this.isNotFound(err)) throw err;
        // deleted in QuickBooks by hand — make it again
      }
    }
    const res = await this.client.create(companyId, type, body);
    const made = res[type]?.Id ?? null;
    if (!made)
      throw new Error(`QuickBooks did not return the new ${type}'s id`);
    return made;
  }

  /**
   * step11 part 3: the QuickBooks Class of a name — by its full name ("Parent:Child"), else
   * made (a plain name only; a sub-class is never made). Null = no class on the line.
   */
  private async classId(
    companyId: number,
    name: string,
    cache: RunCache,
  ): Promise<string | null> {
    if (cache.classes.has(name)) return cache.classes.get(name) ?? null;
    let id: string | null = null;
    try {
      id = await this.findOne(
        companyId,
        'Class',
        `FullyQualifiedName = ${qboQuote(name)}`,
      );
      if (!id && !name.includes(':')) {
        id = await this.created(companyId, 'Class', {
          Name: name.slice(0, 100),
        });
      }
    } catch (err) {
      this.stopOn(err);
      this.logger.warn(
        `company #${companyId}: QuickBooks class "${name}" not found or made: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    cache.classes.set(name, id);
    return id;
  }

  private async refsFor(
    companyId: number,
    scope: BookScope,
    row: Row,
    family: QboFamily,
    cache: RunCache,
  ): Promise<QboRefs> {
    const moneyOut = family.cents < 0;
    const accountIds = new Map<string, string>();
    for (const line of family.lines) {
      const name = qboCategoryName(line.category, moneyOut);
      if (!name || accountIds.has(name)) continue;
      accountIds.set(
        name,
        await this.accountId(
          companyId,
          name,
          typeFor(line.category, cache.types),
          cache,
        ),
      );
    }
    const classIds = new Map<string, string>();
    for (const line of family.lines) {
      if (!line.className || classIds.has(line.className)) continue;
      const id = await this.classId(companyId, line.className, cache);
      if (id) classIds.set(line.className, id);
    }
    return {
      bankAccountId: await this.bankAccountId(companyId, scope, row, cache),
      entity: family.name
        ? await this.entityFor(companyId, family.name, moneyOut, cache)
        : null,
      accountIds,
      classIds,
    };
  }

  /** The QuickBooks account of a category — found by name, else created. */
  private async accountId(
    companyId: number,
    name: string,
    type: Parameters<typeof qboAccountType>[1],
    cache: RunCache,
  ): Promise<string> {
    const known = cache.accounts.get(name);
    if (known) return known;
    const found = await this.findOne(
      companyId,
      'Account',
      `Name = ${qboQuote(name)}`,
    );
    const id =
      found ??
      (await this.created(companyId, 'Account', {
        Name: name,
        ...qboAccountType(name, type),
      }));
    cache.accounts.set(name, id);
    return id;
  }

  /**
   * The bank / credit card account the Plaid account posts to (remembered on it). step11
   * part 3: first the one QuickBooks already has — candidates by name, proven by the
   * transactions both sides hold (`matchBankAccount`); else found by our name; else made.
   */
  private async bankAccountId(
    companyId: number,
    scope: BookScope,
    row: Row,
    cache: RunCache,
  ): Promise<string> {
    const account = row.statement.plaidAccount!;
    if (account.qboAccountId) return account.qboAccountId;
    const name = qboText(account.accountName) || `Bank account ${account.id}`;
    const id =
      (await this.matchBankAccount(companyId, scope, account.id, cache)) ??
      (await this.findOne(companyId, 'Account', `Name = ${qboQuote(name)}`)) ??
      (await this.created(companyId, 'Account', {
        Name: name,
        AccountType: account.kind === 'CREDIT_CARD' ? 'Credit Card' : 'Bank',
      }));
    await this.prisma.plaidAccount.update({
      where: { id: account.id },
      data: { qboAccountId: id },
    });
    row.statement.plaidAccount!.qboAccountId = id;
    return id;
  }

  /**
   * step11 part 3: the QuickBooks account this Plaid account already is, or null. Never
   * throws (a failed look = null, the old exact-name / create path then runs).
   */
  private async matchBankAccount(
    companyId: number,
    scope: BookScope,
    plaidAccountId: number,
    cache: RunCache,
  ): Promise<string | null> {
    try {
      const plaid = await this.prisma.plaidAccount.findUnique({
        where: { id: plaidAccountId },
        select: {
          accountName: true,
          mask: true,
          kind: true,
          item: { select: { institutionName: true } },
        },
      });
      if (!plaid) return null;
      cache.bankAccounts ??= await this.qboBankAccounts(companyId);
      // An account another of the book's Plaid accounts already posts to is not a candidate.
      const taken = new Set(
        (
          await this.prisma.plaidAccount.findMany({
            where: {
              qboAccountId: { not: null },
              item: { bookId: scope.bookId },
              id: { not: plaidAccountId },
            },
            select: { qboAccountId: true },
          })
        ).map((a) => a.qboAccountId!),
      );
      const ours = {
        accountName: plaid.accountName,
        mask: plaid.mask,
        institution: plaid.item.institutionName,
        kind: plaid.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
      } as const;
      const candidates = candidatesFor(
        ours,
        cache.bankAccounts.filter((a) => !taken.has(a.id)),
      );
      if (!candidates.length) return null;
      const since = new Date(Date.now() - MATCH_DAYS * 86_400_000);
      const ourRows: DatedCents[] = (
        await this.prisma.bankTransaction.findMany({
          where: {
            splitOfId: null,
            statement: { plaidAccountId, deletedAt: null },
            OR: [
              { postingDate: { gte: since } },
              { pendingDate: { gte: since } },
            ],
          },
          select: { amount: true, postingDate: true, pendingDate: true },
        })
      ).flatMap((r) => {
        const d = r.postingDate ?? r.pendingDate;
        return d
          ? [{ date: day(d), cents: Math.round(Number(r.amount) * 100) }]
          : [];
      });
      cache.recent ??= await this.recentQboTxns(companyId, day(since));
      for (const { account, score } of candidates) {
        const theirs = cache.recent.get(account.id) ?? [];
        const v = verifyMatch(ourRows, theirs);
        if (acceptMatch(score, v, theirs.length)) {
          this.logger.log(
            `company #${companyId}: Plaid account #${plaidAccountId} (${plaid.accountName}) is QuickBooks account ${account.id} "${account.name}" (name score ${score}, ${v.matched} of ${v.compared} transactions found)`,
          );
          return account.id;
        }
      }
      this.logger.log(
        `company #${companyId}: no QuickBooks account matched ${plaid.accountName} (checked ${candidates.map((c) => `"${c.account.name}"`).join(', ')})`,
      );
      return null;
    } catch (err) {
      this.stopOn(err);
      this.logger.warn(
        `company #${companyId}: QuickBooks account match failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** QuickBooks' live Bank and Credit Card accounts. */
  private async qboBankAccounts(companyId: number): Promise<QboBankAccount[]> {
    const out: QboBankAccount[] = [];
    for (const type of ['Bank', 'Credit Card']) {
      const res = await this.client.query<Record<string, unknown>>(
        companyId,
        `select * from Account where AccountType = ${qboQuote(type)} MAXRESULTS ${MATCH_PAGE}`,
      );
      for (const a of (res.Account as Array<Record<string, unknown>>) ?? []) {
        if (typeof a.Id !== 'string' || a.Active === false) continue;
        out.push({
          id: a.Id,
          name: typeof a.Name === 'string' ? a.Name : '',
          acctNum: typeof a.AcctNum === 'string' ? a.AcctNum : null,
          type,
        });
      }
    }
    return out;
  }

  /**
   * QuickBooks' Purchases and Deposits since a day, by the bank account they are in (a
   * Purchase in its `AccountRef`, a Deposit in its `DepositToAccountRef`); + = money in.
   * QuickBooks cannot filter on those refs, so the whole period is paged (≤ 10 pages each).
   */
  private async recentQboTxns(
    companyId: number,
    since: string,
  ): Promise<Map<string, DatedCents[]>> {
    const out = new Map<string, DatedCents[]>();
    const add = (account: unknown, date: unknown, cents: number) => {
      const id = (account as { value?: string } | undefined)?.value;
      if (!id || typeof date !== 'string' || !cents) return;
      const list = out.get(id) ?? [];
      list.push({ date: date.slice(0, 10), cents });
      out.set(id, list);
    };
    for (const type of ['Purchase', 'Deposit'] as const) {
      for (let page = 0; page < 10; page++) {
        const res = await this.client.query<Record<string, unknown>>(
          companyId,
          `select * from ${type} where TxnDate >= ${qboQuote(since)} STARTPOSITION ${page * MATCH_PAGE + 1} MAXRESULTS ${MATCH_PAGE}`,
        );
        const list = (res[type] as Array<Record<string, unknown>>) ?? [];
        for (const t of list) {
          const total = Math.round(Math.abs(Number(t.TotalAmt ?? 0)) * 100);
          if (type === 'Purchase') {
            add(t.AccountRef, t.TxnDate, t.Credit === true ? total : -total);
          } else {
            add(t.DepositToAccountRef, t.TxnDate, total);
          }
        }
        if (list.length < MATCH_PAGE) break;
      }
    }
    return out;
  }

  /** The payee: an existing vendor / customer / employee by name, else a new one. */
  private async entityFor(
    companyId: number,
    name: string,
    moneyOut: boolean,
    cache: RunCache,
  ): Promise<{ id: string; type: EntityType }> {
    const known = cache.entities.get(name);
    if (known) return known;
    for (const type of ['Vendor', 'Customer', 'Employee'] as const) {
      const id = await this.findOne(
        companyId,
        type,
        `DisplayName = ${qboQuote(name)}`,
      );
      if (id) {
        const entity = { id, type };
        cache.entities.set(name, entity);
        return entity;
      }
    }
    const type: EntityType = moneyOut ? 'Vendor' : 'Customer';
    const entity = {
      id: await this.created(companyId, type, { DisplayName: name }),
      type,
    };
    cache.entities.set(name, entity);
    return entity;
  }

  private async findOne(
    companyId: number,
    entity: 'Account' | 'Class' | EntityType,
    where: string,
  ): Promise<string | null> {
    const res = await this.client.query<Record<string, unknown>>(
      companyId,
      `select * from ${entity} where ${where} MAXRESULTS 1`,
    );
    const list = res[entity] as Array<{ Id?: string }> | undefined;
    return list?.[0]?.Id ?? null;
  }

  private async created(
    companyId: number,
    entity: 'Account' | 'Class' | EntityType,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.client.create(companyId, entity, body);
    const id = res[entity]?.Id;
    if (!id)
      throw new Error(`QuickBooks did not return the new ${entity}'s id`);
    this.logger.log(
      `company #${companyId}: created QuickBooks ${entity} ${id} (${JSON.stringify(body)})`,
    );
    return id;
  }

  private async removeQuietly(
    companyId: number,
    type: string | null,
    id: string,
  ): Promise<void> {
    try {
      await this.client.remove(
        companyId,
        type === 'Deposit' ? 'Deposit' : 'Purchase',
        id,
      );
    } catch (err) {
      this.stopOn(err);
      if (!this.isNotFound(err)) throw err;
    }
  }

  private async fail(rowId: number, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`row #${rowId}: QuickBooks push failed: ${message}`);
    await this.prisma.bankTransaction
      .update({
        where: { id: rowId },
        data: { qboError: message.slice(0, 2000) },
      })
      .catch(() => undefined);
  }

  /** QuickBooks is off for the company, not connected or needs a reconnect: stop the run. */
  private stopOn(err: unknown): void {
    if (
      err instanceof QboCallError &&
      (err.status === 409 || err.status === 401 || err.status === 0)
    ) {
      this.logger.warn(`QuickBooks push stopped: ${err.message}`);
      throw new StopRun(err.message);
    }
    if (
      err instanceof QboCallError &&
      err.status === 404 &&
      /not connected/i.test(err.message)
    ) {
      throw new StopRun(err.message);
    }
  }

  /** The QuickBooks transaction is gone already (deleted there by hand). */
  private isNotFound(err: unknown): boolean {
    return (
      err instanceof QboCallError &&
      /object not found|610|has been deleted|not found/i.test(err.message)
    );
  }
}
