import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import {
  typeFor,
  type TypeContext,
} from '../bookkeeping/chart-of-accounts';
import type { BookScope } from '../bookkeeping/scope';
import { TaxService } from '../bookkeeping/tax.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  familyHash,
  familyLines,
  qboAccountType,
  qboBody,
  qboCategoryName,
  qboQuote,
  qboText,
  qboTypeOf,
  type QboFamily,
  type QboRefs,
} from './qbo-mapping.util';
import { QboCallError, QboSystemClient } from './qbo-system.client';

/** At most this many QuickBooks writes per book per run — the next run takes the rest. */
const MAX_PER_RUN = 150;
const DEBOUNCE_MS = 2_000;

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
    select: { amount: true, offsetAccount: true, name: true, subNameId: true },
  },
} satisfies Prisma.BankTransactionSelect;

type Row = Prisma.BankTransactionGetPayload<{ select: typeof ROW_SELECT }>;

/** What one run of a book has looked up in QuickBooks already. */
interface RunCache {
  accounts: Map<string, string>;
  entities: Map<string, { id: string; type: EntityType } | null>;
  types: TypeContext;
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
        this.logger.warn(`book #${bookId}: QuickBooks push failed: ${String(err)}`);
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
          .remove(r.companyId!, r.qboType === 'Deposit' ? 'Deposit' : 'Purchase', r.qboId!)
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
      let cache: RunCache | null = null;
      for (const row of rows) {
        if (writes >= MAX_PER_RUN) {
          this.again.add(bookId);
          break;
        }
        const family = this.familyOf(row, subNames);
        if (!family) continue;
        const hash = familyHash(family);
        if (row.qboId && row.qboHash === hash) continue;
        cache ??= {
          accounts: new Map(),
          entities: new Map(),
          types: await this.tax.typeContext(scope),
        };
        writes++;
        await this.push(companyId, row, family, hash, cache);
      }
    } catch (err) {
      if (err instanceof StopRun) return;
      throw err;
    }
    if (writes) {
      this.logger.log(`book #${bookId} (company #${companyId}): ${writes} QuickBooks write(s)`);
    }
  }

  /** A pushed row whose statement was deleted leaves QuickBooks too. */
  private async removeOrphans(bookId: number, companyId: number): Promise<number> {
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
        data: { qboId: null, qboType: null, qboHash: null, qboSyncedAt: null, qboError: null },
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

  private familyOf(row: Row, subNames: ReadonlyMap<number, string>): QboFamily | null {
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
      name: row.name ? qboText(row.name) || null : null,
      description: row.description,
      kind: account.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
      plaidAccountId: account.id,
      lines: familyLines(
        {
          amount,
          category: row.offsetAccount,
          description: label(row.subNameId, null),
        },
        row.splits.map((s) => ({
          amount: Number(s.amount),
          category: s.offsetAccount,
          description: label(s.subNameId, s.name),
        })),
      ),
    };
  }

  /** Creates or updates the row's QuickBooks transaction; a failure is kept on the row. */
  private async push(
    companyId: number,
    row: Row,
    family: QboFamily,
    hash: string,
    cache: RunCache,
  ): Promise<void> {
    const type = qboTypeOf(family);
    try {
      const refs = await this.refsFor(companyId, row, family, cache);
      const body = qboBody(family, refs);
      let id = row.qboId;
      if (id && row.qboType !== type) {
        await this.removeQuietly(companyId, row.qboType, id);
        id = null;
      }
      if (id) {
        try {
          await this.client.update(companyId, type, id, body);
        } catch (err) {
          this.stopOn(err);
          if (!this.isNotFound(err)) throw err;
          id = null; // deleted in QuickBooks by hand — make it again
        }
      }
      if (!id) {
        const res = await this.client.create(companyId, type, body);
        id = res[type]?.Id ?? null;
        if (!id) throw new Error(`QuickBooks did not return the new ${type}'s id`);
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

  private async refsFor(
    companyId: number,
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
        await this.accountId(companyId, name, typeFor(line.category, cache.types), cache),
      );
    }
    return {
      bankAccountId: await this.bankAccountId(companyId, row),
      entity: family.name
        ? await this.entityFor(companyId, family.name, moneyOut, cache)
        : null,
      accountIds,
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
    const found = await this.findOne(companyId, 'Account', `Name = ${qboQuote(name)}`);
    const id =
      found ??
      (await this.created(companyId, 'Account', {
        Name: name,
        ...qboAccountType(name, type),
      }));
    cache.accounts.set(name, id);
    return id;
  }

  /** The bank / credit card account the Plaid account posts to (remembered on it). */
  private async bankAccountId(companyId: number, row: Row): Promise<string> {
    const account = row.statement.plaidAccount!;
    if (account.qboAccountId) return account.qboAccountId;
    const name = qboText(account.accountName) || `Bank account ${account.id}`;
    const id =
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
    entity: 'Account' | EntityType,
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
    entity: 'Account' | EntityType,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.client.create(companyId, entity, body);
    const id = res[entity]?.Id;
    if (!id) throw new Error(`QuickBooks did not return the new ${entity}'s id`);
    this.logger.log(`company #${companyId}: created QuickBooks ${entity} ${id} (${JSON.stringify(body)})`);
    return id;
  }

  private async removeQuietly(
    companyId: number,
    type: string | null,
    id: string,
  ): Promise<void> {
    try {
      await this.client.remove(companyId, type === 'Deposit' ? 'Deposit' : 'Purchase', id);
    } catch (err) {
      this.stopOn(err);
      if (!this.isNotFound(err)) throw err;
    }
  }

  private async fail(rowId: number, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`row #${rowId}: QuickBooks push failed: ${message}`);
    await this.prisma.bankTransaction
      .update({ where: { id: rowId }, data: { qboError: message.slice(0, 2000) } })
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
