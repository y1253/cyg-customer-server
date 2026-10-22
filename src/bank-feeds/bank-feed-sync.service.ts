import { withAiUsage } from '../ai/ai-usage.context';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  StatementStatus,
  type BankStatement,
  type PlaidAccount,
  type PlaidItem,
  type PlaidTransaction,
} from '@prisma/client';
import { RulesService } from '../assistant/rules.service';
import { canonicalAccountName } from '../bookkeeping/account-identity.util';
import { UNCATEGORIZED } from '../bookkeeping/chart-of-accounts';
import {
  buildLedgerRows,
  doubleEntry,
  type ExtractedTransaction,
} from '../bookkeeping/ledger.util';
import { NameMemoryService } from '../bookkeeping/name-memory.service';
import { resolveRow } from '../bookkeeping/name-memory.util';
import { scopeOf, scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  bankDelayNote,
  defaultAccountName,
  feedCents,
  isoDay,
  kindOfPlaidType,
  monthLabel,
  monthOf,
  planMonths,
  refreshWindowNote,
  shouldRequestRefresh,
  type BankHealth,
  type MonthPlan,
  type PlaidUpdateStatus,
} from './bank-feed.util';
import { BankRowCategorizer } from './bank-row-categorizer';
import { decrypt } from './crypto.util';
import {
  PlaidApiError,
  PlaidClient,
  type PlaidAccountData,
  type PlaidTransactionData,
} from './plaid.client';

/** Plaid error codes that mean the customer must sign in to their bank again (update mode). */
const LOGIN_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
  'INVALID_CREDENTIALS',
  'INVALID_MFA',
  'ITEM_LOCKED',
  'USER_SETUP_REQUIRED',
  'MFA_NOT_SUPPORTED',
  'NO_ACCOUNTS',
]);

const SYNC_PAGE = 500;
/** History normally arrives within hours; past this the "loading" state is given up. */
const HISTORY_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** Plaid asks to restart the whole sync loop when data changed mid-pagination. */
const MAX_SYNC_RESTARTS = 3;

const day = (d: Date): string => d.toISOString().slice(0, 10);
const money = (cents: number | null): string | null =>
  cents === null ? null : (cents / 100).toFixed(2);

export type ItemStatus = 'ACTIVE' | 'LOGIN_REQUIRED' | 'ERROR' | 'REMOVED';

interface BankStatus {
  updates: PlaidUpdateStatus | null;
  health: BankHealth | null;
}

/**
 * Bank feeds (step11): keeps each connected bank's transactions in `PlaidTransaction`
 * and turns them into one `BankStatement` (`source` PLAID, status DONE) per account and
 * calendar month, with `BankTransaction` rows keyed by `externalId` (Plaid's
 * `transaction_id`).
 *
 * - **Sync** (`syncSoon`): the `SYNC_UPDATES_AVAILABLE` webhook, "Refresh now", a new
 *   connection, and a 6-hourly backstop. `/accounts/get` (balances) then the
 *   `/transactions/sync` cursor loop. One run per item at a time (in-process — pm2 runs
 *   the API in fork mode); a request during a run makes it run again once.
 * - **Rebuild** (DB only, after every sync and hourly): the month statements are planned
 *   from the WHOLE feed (`planMonths`), so balances and the "uploads win" rule are always
 *   current; rows are diffed by `externalId`, so a re-sync never duplicates and never
 *   touches a row's name or category — the customer's edits, splits and attachments stay.
 *   Only NEW rows are named/categorized: the customer's rules and the firm memories first
 *   (`resolveRow`), the AI only for what they do not know.
 */
@Injectable()
export class BankFeedSyncService {
  private readonly logger = new Logger(BankFeedSyncService.name);
  private readonly running = new Map<number, Promise<void>>();
  private readonly again = new Set<number>();
  /** Last `/transactions/refresh` per item (in-process; pm2 fork mode). */
  private readonly lastRefreshAt = new Map<number, Date>();
  /** Day the unchanged "waiting on the bank" note was last logged, per item. */
  private readonly noteLoggedOn = new Map<number, string>();
  private refreshUnsupportedLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plaid: PlaidClient,
    private readonly config: ConfigService,
    private readonly names: NameMemoryService,
    private readonly categorizer: BankRowCategorizer,
    @Optional() private readonly rules?: RulesService,
  ) {}

  private get key(): string {
    return (
      this.config.get<string>('ENCRYPTION_KEY')?.replace(/^"|"$/g, '').trim() ??
      ''
    );
  }

  /** Start a sync now, without waiting. Never throws. */
  syncSoon(itemId: number): void {
    void this.sync(itemId).catch(() => undefined);
  }

  /** Sync one item and wait for it (a second call during a run waits for a re-run). */
  async sync(itemId: number): Promise<void> {
    const current = this.running.get(itemId);
    if (current) {
      this.again.add(itemId);
      return current;
    }
    const run = (async () => {
      try {
        do {
          this.again.delete(itemId);
          await this.runSync(itemId);
        } while (this.again.has(itemId));
      } finally {
        this.running.delete(itemId);
      }
    })();
    this.running.set(itemId, run);
    return run;
  }

  isRunning(itemId: number): boolean {
    return this.running.has(itemId);
  }

  /**
   * While an item's history is still arriving, sync it every 5 minutes, so it shows up
   * even when no webhook ever reaches us (the endless "Bringing in…" of step12).
   */
  @Cron('*/5 * * * *')
  async syncLoading(): Promise<void> {
    if (!this.plaid.configured) return;
    const items = await this.prisma.plaidItem.findMany({
      where: { deletedAt: null, status: 'ACTIVE', historyDone: false },
      select: { id: true },
    });
    for (const { id } of items) {
      if (this.running.has(id)) continue;
      await this.sync(id).catch(() => undefined);
    }
  }

  /** Backstop for missed webhooks. Every sync also keeps Plaid sending them. */
  @Cron('17 */6 * * *')
  async syncAll(): Promise<void> {
    if (!this.plaid.configured) return;
    const items = await this.prisma.plaidItem.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const { id } of items) await this.sync(id).catch(() => undefined);
  }

  /** DB only: a statement uploaded since the last sync takes its month back (uploads win). */
  @Cron(CronExpression.EVERY_HOUR)
  async rebuildAll(): Promise<void> {
    const items = await this.prisma.plaidItem.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    for (const { id } of items) {
      if (this.running.has(id)) continue;
      await this.rebuildItem(id).catch((err) =>
        this.logger.warn(`rebuild of item #${id} failed: ${String(err)}`),
      );
    }
  }

  private async runSync(itemId: number): Promise<void> {
    const item = await this.prisma.plaidItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.deletedAt || item.status === 'REMOVED') return;
    const started = Date.now();
    try {
      const accessToken = decrypt(item.accessToken, this.key);
      const { accounts } = await this.plaid.call<{
        accounts: PlaidAccountData[];
      }>('/accounts/get', { access_token: accessToken });
      const byPlaidId = await this.saveAccounts(item, accounts);

      const { added, modified, removed, cursor, updateStatus } =
        await this.fetchChanges(accessToken, item.cursor);
      await this.saveTransactions(byPlaidId, added, modified, removed);
      // Plaid has nothing yet: ask it why, so the card can say so instead of spinning —
      // and, when its own tries at the bank failed, ask it to go again (step12).
      let note: string | null = null;
      if (!item.historyDone && updateStatus === 'NOT_READY') {
        const bank = await this.bankStatus(item, accessToken);
        note = bank
          ? bankDelayNote(item.institutionName, bank.updates, bank.health)
          : null;
        this.logNote(item, note, bank);
        const failedWithoutSuccess = Boolean(
          bank?.updates?.last_failed_update &&
          !bank.updates.last_successful_update,
        );
        const decision = shouldRequestRefresh({
          now: new Date(),
          lastRefreshAt: this.lastRefreshAt.get(item.id) ?? null,
          institutionId: item.institutionId,
          failedWithoutSuccess,
          manual: false,
        });
        if (decision === 'ok') {
          await this.requestRefresh(item, accessToken, 'auto');
        }
      }
      // `/transactions/sync` says itself when the history is in — the webhook is not the
      // only way to learn it (a missed one left the card loading forever). While the bank
      // is failing the give-up waits, so the history is still pulled once it is back.
      const historyDone =
        item.historyDone ||
        updateStatus === 'HISTORICAL_UPDATE_COMPLETE' ||
        (!note && Date.now() - item.createdAt.getTime() > HISTORY_GIVE_UP_MS);
      await this.prisma.plaidItem.update({
        where: { id: item.id },
        data: {
          cursor,
          lastSyncAt: new Date(),
          status: 'ACTIVE',
          // On an ACTIVE item `error` is the "waiting on the bank" note (null = none).
          error: note,
          historyDone,
        },
      });
      this.logger.log(
        `item #${item.id} synced: +${added.length} ~${modified.length} -${removed.length} in ${Date.now() - started}ms`,
      );
    } catch (err) {
      await this.recordError(item, err);
    }
    try {
      await this.rebuildItem(item.id);
    } catch (err) {
      this.logger.warn(`rebuild of item #${item.id} failed: ${String(err)}`);
    }
  }

  /**
   * "Refresh now": ask Plaid to go to the bank (not just re-read its cache), then sync.
   * Answers the note to show when the bank does not allow it at this hour, else null.
   */
  async refreshNow(itemId: number): Promise<string | null> {
    const item = await this.prisma.plaidItem.findUnique({
      where: { id: itemId },
    });
    if (item && !item.deletedAt && item.status === 'ACTIVE') {
      const decision = shouldRequestRefresh({
        now: new Date(),
        lastRefreshAt: this.lastRefreshAt.get(item.id) ?? null,
        institutionId: item.institutionId,
        failedWithoutSuccess: false,
        manual: true,
      });
      if (decision === 'outside-window') {
        this.syncSoon(item.id);
        return refreshWindowNote(item.institutionName, item.institutionId);
      }
      if (decision === 'ok') {
        try {
          await this.requestRefresh(
            item,
            decrypt(item.accessToken, this.key),
            'manual',
          );
        } catch (err) {
          this.logger.warn(`item #${item.id} refresh skipped: ${String(err)}`);
        }
      }
    }
    this.syncSoon(itemId);
    return null;
  }

  /**
   * `/transactions/refresh`: Plaid pulls from the bank now and fires
   * `SYNC_UPDATES_AVAILABLE` (→ `syncSoon`); the `*\/5` cron is the backstop. Billed per
   * call, so callers go through `shouldRequestRefresh`. Never throws.
   */
  private async requestRefresh(
    item: PlaidItem,
    accessToken: string,
    why: 'auto' | 'manual',
  ): Promise<void> {
    this.lastRefreshAt.set(item.id, new Date());
    try {
      await this.plaid.call('/transactions/refresh', {
        access_token: accessToken,
      });
      this.logger.log(`item #${item.id} refresh requested (${why})`);
    } catch (err) {
      const code = err instanceof PlaidApiError ? err.code : null;
      if (code === 'PRODUCTS_NOT_SUPPORTED' || code === 'INVALID_PRODUCT') {
        if (!this.refreshUnsupportedLogged) {
          this.refreshUnsupportedLogged = true;
          this.logger.warn(
            `item #${item.id} refresh refused: ${code} — enable Transactions Refresh ` +
              '(transactions_refresh) for this Plaid account in the Plaid dashboard',
          );
        }
        return;
      }
      this.logger.warn(
        `item #${item.id} refresh refused (${why}): ${code ?? String(err)}`,
      );
    }
  }

  /**
   * The "waiting on the bank" note in the log: when it changes, and once a day while it
   * stays (it used to go silent, which looked like nothing was happening).
   */
  private logNote(
    item: PlaidItem,
    note: string | null,
    bank: BankStatus | null,
  ): void {
    if (!note) {
      this.noteLoggedOn.delete(item.id);
      return;
    }
    const today = isoDay();
    if (note === item.error && this.noteLoggedOn.get(item.id) === today) return;
    this.noteLoggedOn.set(item.id, today);
    this.logger.log(
      `item #${item.id} waiting on the bank: ${note} ` +
        `(Plaid last_failed_update=${bank?.updates?.last_failed_update ?? '-'}, ` +
        `last_successful_update=${bank?.updates?.last_successful_update ?? '-'}, ` +
        `bank updates=${bank?.health?.updates ?? '-'}, open incidents=${bank?.health?.openIncidents ?? '-'})`,
    );
  }

  /**
   * Plaid's own tries at the bank (`/item/get` → `status.transactions`) and, when one
   * failed with no success, the bank's status at Plaid. Null on any error.
   */
  private async bankStatus(
    item: PlaidItem,
    accessToken: string,
  ): Promise<BankStatus | null> {
    try {
      const { item: info, status } = await this.plaid.call<{
        item: { institution_id: string | null };
        status?: { transactions?: PlaidUpdateStatus | null };
      }>('/item/get', { access_token: accessToken });
      const updates = status?.transactions ?? null;
      if (!updates?.last_failed_update || updates.last_successful_update) {
        return { updates, health: null };
      }
      const institutionId = info.institution_id ?? item.institutionId;
      const health: BankHealth | null = institutionId
        ? await this.plaid
            .call<{
              institution?: {
                status?: {
                  transactions_updates?: { status?: string } | null;
                  health_incidents?: Array<{ end_date: string | null }> | null;
                } | null;
              };
            }>('/institutions/get_by_id', {
              institution_id: institutionId,
              country_codes: this.plaid.countryCodes,
              options: { include_status: true },
            })
            .then(({ institution }) => ({
              updates: institution?.status?.transactions_updates?.status,
              openIncidents: (
                institution?.status?.health_incidents ?? []
              ).filter((h) => !h.end_date).length,
            }))
            .catch(() => null)
        : null;
      return { updates, health };
    } catch {
      return null;
    }
  }

  private async recordError(item: PlaidItem, err: unknown): Promise<void> {
    const plaidErr = err instanceof PlaidApiError ? err : null;
    const status: ItemStatus =
      plaidErr && LOGIN_CODES.has(plaidErr.code) ? 'LOGIN_REQUIRED' : 'ERROR';
    const message = plaidErr
      ? `${plaidErr.code}: ${plaidErr.displayMessage ?? plaidErr.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    this.logger.warn(`item #${item.id} sync failed (${status}): ${message}`);
    await this.prisma.plaidItem
      .update({
        where: { id: item.id },
        data: { status, error: message.slice(0, 2000) },
      })
      .catch(() => undefined);
  }

  /** The `/transactions/sync` loop from `cursor` to now. */
  private async fetchChanges(accessToken: string, start: string | null) {
    for (let attempt = 0; ; attempt++) {
      const added: PlaidTransactionData[] = [];
      const modified: PlaidTransactionData[] = [];
      const removed: string[] = [];
      let cursor = start;
      let updateStatus: string | null = null;
      try {
        for (;;) {
          const page = await this.plaid.call<{
            added: PlaidTransactionData[];
            modified: PlaidTransactionData[];
            removed: Array<{ transaction_id: string }>;
            next_cursor: string;
            has_more: boolean;
            /** NOT_READY | INITIAL_UPDATE_COMPLETE | HISTORICAL_UPDATE_COMPLETE */
            transactions_update_status?: string;
          }>('/transactions/sync', {
            access_token: accessToken,
            ...(cursor ? { cursor } : {}),
            count: SYNC_PAGE,
          });
          added.push(...page.added);
          modified.push(...page.modified);
          removed.push(...page.removed.map((r) => r.transaction_id));
          cursor = page.next_cursor;
          updateStatus = page.transactions_update_status ?? updateStatus;
          if (!page.has_more) break;
        }
        return { added, modified, removed, cursor, updateStatus };
      } catch (err) {
        const restart =
          err instanceof PlaidApiError &&
          err.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' &&
          attempt < MAX_SYNC_RESTARTS;
        if (!restart) throw err;
      }
    }
  }

  /**
   * Upserts the item's accounts with today's balance. A NEW account is filed under the
   * book's existing account when it is the same one (bank text + last 4 — the reader's
   * `canonicalAccountName`), else "<bank> <last 4>". An account of the item that Plaid no
   * longer returns was unchecked in Link's Account Select: it is marked not `shared`.
   */
  async saveAccounts(
    item: PlaidItem,
    accounts: readonly PlaidAccountData[],
  ): Promise<Map<string, PlaidAccount>> {
    const scope = scopeOf(item);
    const existing = await this.prisma.plaidAccount.findMany({
      where: { accountId: { in: accounts.map((a) => a.account_id) } },
    });
    const byId = new Map(existing.map((a) => [a.accountId, a]));
    const now = new Date();
    let known: Array<{ name: string; kind: string | null }> | null = null;

    for (const a of accounts) {
      const kind = kindOfPlaidType(a.type);
      const currency = (a.balances.iso_currency_code ?? '').slice(0, 3) || null;
      const balance =
        a.balances.current === null
          ? null
          : (Math.round(a.balances.current * 100) / 100).toFixed(2);
      const common = {
        name: a.name.slice(0, 191),
        officialName: a.official_name?.slice(0, 191) ?? null,
        mask: a.mask?.slice(0, 8) ?? null,
        type: a.type.slice(0, 20),
        subtype: a.subtype?.slice(0, 40) ?? null,
        currency,
        currentBalance: balance,
        balanceAt: now,
        shared: true,
      };
      const found = byId.get(a.account_id);
      if (found) {
        byId.set(
          a.account_id,
          await this.prisma.plaidAccount.update({
            where: { id: found.id },
            data: common,
          }),
        );
        continue;
      }
      known ??= await this.knownAccounts(scope);
      const accountName =
        canonicalAccountName(
          {
            accountName: defaultAccountName(item.institutionName, a),
            accountNumber: a.mask,
            accountKind: kind,
          },
          known,
        ) ?? defaultAccountName(item.institutionName, a);
      known.push({ name: accountName, kind });
      byId.set(
        a.account_id,
        await this.prisma.plaidAccount.create({
          data: {
            ...common,
            plaidItemId: item.id,
            accountId: a.account_id,
            accountName: accountName.slice(0, 191),
            kind,
            // Added to a bank already set up ("Change accounts"): today until the customer
            // picks its start date, so two years are not filed (and categorized) unasked.
            startDate: item.setupAt ? new Date(`${day(now)}T00:00:00Z`) : null,
          },
        }),
      );
    }
    if (accounts.length) {
      await this.prisma.plaidAccount.updateMany({
        where: {
          plaidItemId: item.id,
          shared: true,
          accountId: { notIn: accounts.map((a) => a.account_id) },
        },
        data: { shared: false },
      });
    }
    return byId;
  }

  /** The book's account folders: read statements and other connected accounts. */
  private async knownAccounts(scope: BookScope) {
    const [statements, feeds] = await Promise.all([
      this.prisma.bankStatement.findMany({
        where: {
          ...scopeWhere(scope),
          deletedAt: null,
          accountName: { not: null },
        },
        distinct: ['accountName', 'accountKind'],
        select: { accountName: true, accountKind: true },
      }),
      this.prisma.plaidAccount.findMany({
        where: { item: { ...scopeWhere(scope), deletedAt: null } },
        select: { accountName: true, kind: true },
      }),
    ]);
    return [
      ...statements.map((s) => ({ name: s.accountName!, kind: s.accountKind })),
      ...feeds.map((f) => ({ name: f.accountName, kind: f.kind })),
    ];
  }

  private async saveTransactions(
    accounts: Map<string, PlaidAccount>,
    added: readonly PlaidTransactionData[],
    modified: readonly PlaidTransactionData[],
    removed: readonly string[],
  ): Promise<void> {
    const rows = [...added, ...modified].filter((t) =>
      accounts.has(t.account_id),
    );
    const dataOf = (t: PlaidTransactionData) => ({
      plaidAccountId: accounts.get(t.account_id)!.id,
      date: new Date(`${t.date}T00:00:00Z`),
      authorizedDate: t.authorized_date
        ? new Date(`${t.authorized_date}T00:00:00Z`)
        : null,
      name: (t.name || '(no description)').slice(0, 512),
      merchantName: t.merchant_name?.slice(0, 191) ?? null,
      amount: (Math.round(t.amount * 100) / 100).toFixed(2),
      currency: (t.iso_currency_code ?? '').slice(0, 3) || null,
      category: t.personal_finance_category?.detailed?.slice(0, 80) ?? null,
      pending: t.pending,
      removedAt: null,
    });
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const have = new Set(
        (
          await this.prisma.plaidTransaction.findMany({
            where: {
              transactionId: { in: batch.map((t) => t.transaction_id) },
            },
            select: { transactionId: true },
          })
        ).map((r) => r.transactionId),
      );
      const fresh = batch.filter((t) => !have.has(t.transaction_id));
      if (fresh.length) {
        await this.prisma.plaidTransaction.createMany({
          data: fresh.map((t) => ({
            transactionId: t.transaction_id,
            ...dataOf(t),
          })),
          skipDuplicates: true,
        });
      }
      for (const t of batch.filter((b) => have.has(b.transaction_id))) {
        await this.prisma.plaidTransaction.update({
          where: { transactionId: t.transaction_id },
          data: dataOf(t),
        });
      }
    }
    if (removed.length) {
      await this.prisma.plaidTransaction.updateMany({
        where: { transactionId: { in: [...removed] } },
        data: { removedAt: new Date() },
      });
    }
  }

  /** Rebuild every account of one item (DB only). */
  async rebuildItem(itemId: number): Promise<void> {
    const item = await this.prisma.plaidItem.findUnique({
      where: { id: itemId },
      include: { accounts: true },
    });
    // No month is filed before the customer has chosen each account's start date.
    if (!item || !item.setupAt) return;
    for (const account of item.accounts) {
      if (account.shared) await this.rebuildAccount(item, account);
      else await this.dropAccount(account);
    }
  }

  /**
   * An account the customer stopped sharing: its live feed months leave the books. A
   * customer-deleted month stays as the marker, should it be shared again.
   */
  private async dropAccount(account: PlaidAccount): Promise<void> {
    const { count } = await this.prisma.bankStatement.deleteMany({
      where: { plaidAccountId: account.id, deletedAt: null },
    });
    if (count) {
      this.logger.log(
        `account #${account.id}: removed ${count} feed month(s), no longer shared`,
      );
    }
  }

  private async rebuildAccount(
    item: PlaidItem,
    account: PlaidAccount,
  ): Promise<void> {
    const scope = scopeOf(item);
    const kind = account.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK';
    const txns = await this.prisma.plaidTransaction.findMany({
      where: { plaidAccountId: account.id, pending: false, removedAt: null },
    });
    const byId = new Map(txns.map((t) => [t.transactionId, t]));
    const uploads = await this.prisma.bankStatement.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        source: { not: 'PLAID' },
        accountName: account.accountName,
        status: { in: [StatementStatus.DONE, StatementStatus.NEEDS_REVIEW] },
        periodStart: { not: null },
        periodEnd: { not: null },
      },
      select: { periodStart: true, periodEnd: true },
    });
    const plans = planMonths({
      kind,
      currentCents:
        account.currentBalance === null
          ? null
          : Math.round(Number(account.currentBalance) * 100),
      today: isoDay(account.balanceAt ?? new Date()),
      txns: txns.map((t) => ({
        id: t.transactionId,
        date: day(t.date),
        cents: feedCents(t.amount.toString()),
      })),
      covered: uploads.map((u) => ({
        start: day(u.periodStart!),
        end: day(u.periodEnd!),
      })),
      startDate: account.startDate ? day(account.startDate) : null,
    });

    const existing = await this.prisma.bankStatement.findMany({
      where: { plaidAccountId: account.id },
    });
    const byMonth = new Map<string, BankStatement>();
    for (const s of existing) {
      if (!s.periodStart) continue;
      const m = monthOf(day(s.periodStart));
      // A customer-deleted month wins over a live duplicate: it stays deleted.
      if (!byMonth.has(m) || s.deletedAt) byMonth.set(m, s);
    }

    // Months no longer planned (an upload now covers them, or before the start date): the feed's copy goes away, so
    // the same transactions are never in the ledger twice. A customer-deleted one stays as
    // the marker that keeps the month out.
    const planned = new Set(plans.map((p) => monthOf(p.periodStart)));
    const stale = existing.filter(
      (s) =>
        !s.deletedAt &&
        (!s.periodStart || !planned.has(monthOf(day(s.periodStart)))),
    );
    if (stale.length) {
      await this.prisma.bankStatement.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
      this.logger.log(
        `account #${account.id}: removed ${stale.length} feed month(s) an upload now covers`,
      );
    }

    // One statement per planned month (created, or its balances brought up to date).
    const live: Array<{ statement: BankStatement; plan: MonthPlan }> = [];
    for (const plan of plans) {
      const found = byMonth.get(monthOf(plan.periodStart));
      if (found?.deletedAt) continue;
      const fields = {
        periodStart: new Date(`${plan.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${plan.periodEnd}T00:00:00Z`),
        openingBalance: money(plan.openingCents),
        closingBalance: money(plan.closingCents),
        transactionCount: plan.txnIds.length,
        currency: account.currency,
      };
      let statement: BankStatement;
      if (!found) {
        statement = await this.prisma.bankStatement.create({
          data: {
            ...scopeWhere(scope),
            ...fields,
            filename:
              `${account.accountName} · ${monthLabel(plan.periodStart)}`.slice(
                0,
                191,
              ),
            storageKey: '',
            sizeBytes: 0,
            source: 'PLAID',
            status: StatementStatus.DONE,
            verification: 'UNVERIFIED',
            accountName: account.accountName,
            accountKind: kind,
            bankName: item.institutionName,
            plaidAccountId: account.id,
            processedAt: new Date(),
          },
        });
      } else if (changed(found, fields)) {
        statement = await this.prisma.bankStatement.update({
          where: { id: found.id },
          data: { ...fields, processedAt: new Date() },
        });
      } else {
        statement = found;
      }
      live.push({ statement, plan });
    }

    await this.syncRows(scope, item, live, byId);
  }

  /**
   * Brings the ledger rows of the account's month statements in line with the feed.
   * Existing rows (by `externalId`) only take the bank's facts — date, description,
   * amount, statement, position; their name, category, splits and attachments stay.
   */
  private async syncRows(
    scope: BookScope,
    item: PlaidItem,
    live: ReadonlyArray<{ statement: BankStatement; plan: MonthPlan }>,
    txns: ReadonlyMap<string, PlaidTransaction>,
  ): Promise<void> {
    const desired = new Map<
      string,
      { statement: BankStatement; position: number; txn: PlaidTransaction }
    >();
    for (const { statement, plan } of live) {
      plan.txnIds.forEach((id, position) =>
        desired.set(id, { statement, position, txn: txns.get(id)! }),
      );
    }
    const statementIds = live.map((l) => l.statement.id);
    const existing = await this.prisma.bankTransaction.findMany({
      where: {
        externalId: { not: null },
        OR: [
          { statementId: { in: statementIds } },
          { externalId: { in: [...desired.keys()] } },
        ],
      },
      select: {
        id: true,
        externalId: true,
        statementId: true,
        position: true,
        postingDate: true,
        pendingDate: true,
        description: true,
        amount: true,
        offsetAccount: true,
      },
    });

    const gone = existing.filter((r) => !desired.has(r.externalId!));
    if (gone.length) {
      await this.prisma.bankTransaction.deleteMany({
        where: { id: { in: gone.map((r) => r.id) } },
      });
    }

    const seen = new Set<string>();
    for (const row of existing) {
      const want = desired.get(row.externalId!);
      if (!want) continue;
      seen.add(row.externalId!);
      const t = want.txn;
      const amount = (feedCents(t.amount.toString()) / 100).toFixed(2);
      const bank = want.statement.accountName ?? '';
      const next = {
        statementId: want.statement.id,
        position: want.position,
        postingDate: t.date,
        pendingDate: t.authorizedDate,
        description: t.name.slice(0, 512),
        amount,
      };
      const same =
        row.statementId === next.statementId &&
        row.position === next.position &&
        sameDay(row.postingDate, next.postingDate) &&
        sameDay(row.pendingDate, next.pendingDate) &&
        row.description === next.description &&
        Number(row.amount).toFixed(2) === amount;
      if (same) continue;
      await this.prisma.bankTransaction.updateMany({
        where: { id: row.id },
        data: {
          ...next,
          ...doubleEntry(Number(amount), bank, row.offsetAccount),
        },
      });
      // Its splits follow it to the new statement, dates and position.
      await this.prisma.bankTransaction.updateMany({
        where: { splitOfId: row.id },
        data: {
          statementId: next.statementId,
          position: next.position,
          postingDate: next.postingDate,
          pendingDate: next.pendingDate,
        },
      });
    }

    const fresh = [...desired.entries()].filter(([id]) => !seen.has(id));
    if (fresh.length)
      await this.insertRows(
        scope,
        item,
        fresh.map(([, v]) => v),
      );
  }

  /** New feed rows: named and categorized (rules → memories → AI), then inserted. */
  private async insertRows(
    scope: BookScope,
    item: PlaidItem,
    rows: ReadonlyArray<{
      statement: BankStatement;
      position: number;
      txn: PlaidTransaction;
    }>,
  ): Promise<void> {
    const lines: ExtractedTransaction[] = rows.map(({ txn }) => ({
      pendingDate: txn.authorizedDate ? day(txn.authorizedDate) : null,
      postingDate: day(txn.date),
      description: txn.name,
      name: txn.merchantName,
      amount: feedCents(txn.amount.toString()) / 100,
      balanceAfter: null,
      offsetAccount: UNCATEGORIZED,
    }));
    const guessed = await this.guess(
      scope,
      item.institutionName,
      lines,
      rows.map((r) => r.txn),
    );
    const { lines: resolved, customAccounts } =
      await this.names.resolveStatement(scope, guessed, item.institutionName);

    const data = rows.map(({ statement, position, txn }, i) => {
      const [row] = buildLedgerRows(
        [resolved[i]],
        statement.accountName ?? '',
        customAccounts,
      );
      return {
        ...row,
        position,
        statementId: statement.id,
        externalId: txn.transactionId,
        ...scopeWhere(scope),
      };
    });
    for (let i = 0; i < data.length; i += 500) {
      await this.prisma.bankTransaction.createMany({
        data: data.slice(i, i + 500),
        skipDuplicates: true,
      });
    }
    this.logger.log(`item #${item.id}: ${data.length} new ledger row(s)`);
  }

  /**
   * The AI's name + category for the rows the customer's rules and the firm memories
   * cannot place. An AI outage leaves them Uncategorized (never fails the sync).
   */
  private async guess(
    scope: BookScope,
    bankName: string | null,
    lines: ExtractedTransaction[],
    txns: readonly PlaidTransaction[],
  ): Promise<ExtractedTransaction[]> {
    if (!this.categorizer.configured || !lines.length) return lines;
    try {
      const ctx = {
        ...(await this.names.contextFor(
          scope,
          lines.map((l) => l.description),
          lines.map((l) => l.name),
        )),
        bankName,
      };
      const unknown = lines
        .map((l, i) => ({ l, i, r: resolveRow(l, ctx) }))
        .filter(({ r }) => r.category === UNCATEGORIZED || !r.name);
      if (!unknown.length) return lines;
      const rules =
        (await this.rules?.promptBlock(
          scope,
          'CATEGORY',
          'BANK_FEED_CATEGORIZER',
        )) ?? '';
      const answers = await withAiUsage(
        { ...scope, feature: 'BANK_ROWS' },
        () =>
          this.categorizer.categorize(
            unknown.map(({ l, i }) => ({
              key: String(i),
              description: l.description,
              merchant: l.name ?? null,
              amount: l.amount,
              hint: txns[i].category,
            })),
            rules,
          ),
      );
      return lines.map((l, i) => {
        const a = answers.get(String(i));
        return a
          ? { ...l, name: l.name || a.name, offsetAccount: a.category }
          : l;
      });
    } catch (err) {
      this.logger.warn(
        `categorizing feed rows failed, filing them Uncategorized: ${String(err)}`,
      );
      return lines;
    }
  }
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return (a === null && b === null) || (!!a && !!b && day(a) === day(b));
}

function changed(
  s: BankStatement,
  f: {
    periodStart: Date;
    periodEnd: Date;
    openingBalance: string | null;
    closingBalance: string | null;
    transactionCount: number;
    currency: string | null;
  },
): boolean {
  const dec = (v: unknown) =>
    v === null || v === undefined ? null : Number(v).toFixed(2);
  return (
    !sameDay(s.periodStart, f.periodStart) ||
    !sameDay(s.periodEnd, f.periodEnd) ||
    dec(s.openingBalance) !== f.openingBalance ||
    dec(s.closingBalance) !== f.closingBalance ||
    s.transactionCount !== f.transactionCount ||
    s.currency !== f.currency
  );
}
