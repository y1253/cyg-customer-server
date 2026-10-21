import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlaidAccount, PlaidItem } from '@prisma/client';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { BankFeedSyncService, type ItemStatus } from './bank-feed-sync.service';
import { decrypt, encrypt } from './crypto.util';
import {
  PlaidApiError,
  PlaidClient,
  type PlaidAccountData,
} from './plaid.client';
import {
  webhookKeyId,
  verifyPlaidWebhook,
  type PlaidJwk,
} from './plaid-webhook.util';

/** Plaid keeps up to 2 years of history for Transactions; ask for all of it. */
const DAYS_REQUESTED = 730;

export interface BankConnectionView {
  id: number;
  institutionName: string | null;
  status: ItemStatus;
  /** Plaid's reason for LOGIN_REQUIRED / ERROR. */
  error: string | null;
  /** All past transactions (up to 2 years) have arrived. */
  historyDone: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  accounts: Array<{
    id: number;
    name: string;
    mask: string | null;
    kind: string;
    /** The folder its months are filed under. */
    accountName: string;
    currency: string | null;
    currentBalance: number | null;
  }>;
}

function viewOf(
  item: PlaidItem & { accounts: PlaidAccount[] },
): BankConnectionView {
  return {
    id: item.id,
    institutionName: item.institutionName,
    status: item.status as ItemStatus,
    error: item.error,
    historyDone: item.historyDone,
    lastSyncAt: item.lastSyncAt,
    createdAt: item.createdAt,
    accounts: item.accounts
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        id: a.id,
        name: a.name,
        mask: a.mask,
        kind: a.kind,
        accountName: a.accountName,
        currency: a.currency,
        currentBalance:
          a.currentBalance === null ? null : Number(a.currentBalance),
      })),
  };
}

/**
 * The customer side of bank feeds (step11): Plaid Link tokens, connecting a bank to ONE
 * book, the list of connections, Refresh and Disconnect — plus the Plaid webhook.
 * Every route is book-scoped; another book's connection answers 404.
 */
@Injectable()
export class BankFeedsService {
  private readonly logger = new Logger(BankFeedsService.name);
  /** Plaid webhook keys by `kid` — fetched once each. */
  private readonly keys = new Map<string, PlaidJwk>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly plaid: PlaidClient,
    private readonly sync: BankFeedSyncService,
    private readonly config: ConfigService,
  ) {}

  private get key(): string {
    return (
      this.config.get<string>('ENCRYPTION_KEY')?.replace(/^"|"$/g, '').trim() ??
      ''
    );
  }

  get enabled(): boolean {
    return this.plaid.configured && Boolean(this.key);
  }

  async list(scope: BookScope): Promise<BankConnectionView[]> {
    const items = await this.prisma.plaidItem.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      include: { accounts: true },
      orderBy: { createdAt: 'asc' },
    });
    return items.map(viewOf);
  }

  private async owned(scope: BookScope, id: number): Promise<PlaidItem> {
    const item = await this.prisma.plaidItem.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!item) throw new NotFoundException('Bank connection not found');
    return item;
  }

  private async view(id: number): Promise<BankConnectionView> {
    const item = await this.prisma.plaidItem.findUniqueOrThrow({
      where: { id },
      include: { accounts: true },
    });
    return viewOf(item);
  }

  /**
   * A Plaid Link token. With `itemId` it opens Link in UPDATE mode, so the customer signs
   * in to that bank again (status LOGIN_REQUIRED) without making a new connection.
   */
  async linkToken(
    scope: BookScope,
    itemId?: number,
  ): Promise<{ linkToken: string }> {
    const base: Record<string, unknown> = {
      client_name: 'CYG Finance',
      language: 'en',
      country_codes: this.plaid.countryCodes,
      user: { client_user_id: `customer-${scope.customerId}` },
      ...(this.plaid.webhookUrl ? { webhook: this.plaid.webhookUrl } : {}),
      ...(this.plaid.redirectUri
        ? { redirect_uri: this.plaid.redirectUri }
        : {}),
    };
    const body = itemId
      ? {
          ...base,
          access_token: decrypt(
            (await this.owned(scope, itemId)).accessToken,
            this.key,
          ),
        }
      : {
          ...base,
          products: ['transactions'],
          transactions: { days_requested: DAYS_REQUESTED },
        };
    const res = await this.call<{ link_token: string }>(
      '/link/token/create',
      body,
    );
    return { linkToken: res.link_token };
  }

  /** Link succeeded: keep the connection (token encrypted) and start the first sync. */
  async exchange(
    scope: BookScope,
    publicToken: string,
  ): Promise<BankConnectionView> {
    const { access_token, item_id } = await this.call<{
      access_token: string;
      item_id: string;
    }>('/item/public_token/exchange', { public_token: publicToken });

    const { item, accounts } = await this.call<{
      item: { institution_id: string | null };
      accounts: PlaidAccountData[];
    }>('/accounts/get', { access_token });
    let institutionName: string | null = null;
    if (item.institution_id) {
      const inst = await this.call<{ institution: { name: string } }>(
        '/institutions/get_by_id',
        {
          institution_id: item.institution_id,
          country_codes: this.plaid.countryCodes,
        },
      ).catch(() => null);
      institutionName = inst?.institution.name ?? null;
    }

    // The same bank login twice would put every transaction in the ledger twice.
    const masks = new Set(accounts.map((a) => a.mask).filter(Boolean));
    const twin = item.institution_id
      ? await this.prisma.plaidItem.findFirst({
          where: {
            ...scopeWhere(scope),
            deletedAt: null,
            institutionId: item.institution_id,
            accounts: { some: { mask: { in: [...masks] as string[] } } },
          },
        })
      : null;
    if (twin) {
      await this.plaid
        .call('/item/remove', { access_token })
        .catch(() => undefined);
      throw new ConflictException(
        `${institutionName ?? 'This bank'} is already connected here. Use "Sign in again" on it instead.`,
      );
    }

    const saved = await this.prisma.plaidItem.create({
      data: {
        ...scopeWhere(scope),
        itemId: item_id,
        accessToken: encrypt(access_token, this.key),
        institutionId: item.institution_id?.slice(0, 32) ?? null,
        institutionName: institutionName?.slice(0, 191) ?? null,
      },
    });
    this.logger.log(
      `item #${saved.id} connected (${institutionName ?? 'unknown bank'})`,
    );
    this.sync.syncSoon(saved.id);
    return this.view(saved.id);
  }

  /** The customer signed in again (Link update mode): back to ACTIVE and sync. */
  async reconnected(scope: BookScope, id: number): Promise<BankConnectionView> {
    const item = await this.owned(scope, id);
    await this.prisma.plaidItem.update({
      where: { id: item.id },
      data: { status: 'ACTIVE', error: null },
    });
    this.sync.syncSoon(item.id);
    return this.view(item.id);
  }

  /** "Refresh now": sync and answer when done. */
  async refresh(scope: BookScope, id: number): Promise<BankConnectionView> {
    const item = await this.owned(scope, id);
    if (item.status === 'LOGIN_REQUIRED') {
      throw new BadRequestException('Sign in to your bank again first');
    }
    await this.sync.sync(item.id);
    return this.view(item.id);
  }

  /**
   * Disconnect: Plaid forgets the login and we delete the access token. The statements
   * already imported stay in the books.
   */
  async remove(scope: BookScope, id: number): Promise<void> {
    const item = await this.owned(scope, id);
    try {
      await this.plaid.call('/item/remove', {
        access_token: decrypt(item.accessToken, this.key),
      });
    } catch (err) {
      // Already gone at Plaid is fine; anything else is logged, the disconnect still holds.
      this.logger.warn(`item #${item.id} /item/remove: ${String(err)}`);
    }
    await this.prisma.plaidItem.update({
      where: { id: item.id },
      data: {
        status: 'REMOVED',
        deletedAt: new Date(),
        accessToken: '',
        cursor: null,
      },
    });
  }

  /** Plaid errors as a customer-readable 400 (their display message when they gave one). */
  private async call<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.plaid.call<T>(path, body);
    } catch (err) {
      if (err instanceof PlaidApiError) {
        this.logger.warn(`${path}: ${err.code} ${err.message}`);
        throw new BadRequestException(
          err.displayMessage ??
            'We could not reach your bank through Plaid. Please try again.',
        );
      }
      throw err;
    }
  }

  // ── Webhook ──────────────────────────────────────────────────────────────────

  /** Verifies a Plaid webhook. Null = genuine, else why not. */
  async verify(
    token: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<string | null> {
    if (!token || !rawBody) return 'missing signature or body';
    const kid = webhookKeyId(token);
    if (!kid) return 'not an ES256 token';
    let key = this.keys.get(kid);
    if (!key) {
      const res = await this.plaid
        .call<{
          key: PlaidJwk;
        }>('/webhook_verification_key/get', { key_id: kid })
        .catch(() => null);
      if (!res) return 'unknown key';
      key = res.key;
      this.keys.set(kid, key);
    }
    return verifyPlaidWebhook(token, key, rawBody);
  }

  /** A verified webhook. Answers fast; the sync runs in the background. */
  async handle(body: {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    historical_update_complete?: boolean;
    error?: {
      error_code?: string;
      display_message?: string | null;
      error_message?: string;
    } | null;
  }): Promise<void> {
    if (!body.item_id) return;
    const item = await this.prisma.plaidItem.findUnique({
      where: { itemId: body.item_id },
    });
    if (!item || item.deletedAt) return;
    const type = body.webhook_type;
    const code = body.webhook_code;
    this.logger.log(`webhook ${type}/${code} for item #${item.id}`);

    if (type === 'TRANSACTIONS') {
      if (body.historical_update_complete && !item.historyDone) {
        await this.prisma.plaidItem.update({
          where: { id: item.id },
          data: { historyDone: true },
        });
      }
      this.sync.syncSoon(item.id);
      return;
    }
    if (type !== 'ITEM') return;
    if (code === 'LOGIN_REPAIRED') {
      await this.prisma.plaidItem.update({
        where: { id: item.id },
        data: { status: 'ACTIVE', error: null },
      });
      this.sync.syncSoon(item.id);
      return;
    }
    const reason = (fallback: string) =>
      (
        body.error?.display_message ||
        body.error?.error_message ||
        fallback
      ).slice(0, 2000);
    if (code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT') {
      await this.prisma.plaidItem.update({
        where: { id: item.id },
        data: {
          status: 'LOGIN_REQUIRED',
          error: reason('Your bank asks you to sign in again.'),
        },
      });
    } else if (
      code === 'USER_PERMISSION_REVOKED' ||
      code === 'USER_ACCOUNT_REVOKED'
    ) {
      await this.prisma.plaidItem.update({
        where: { id: item.id },
        data: {
          status: 'ERROR',
          error:
            'Access was turned off at your bank. Connect it again to resume.',
        },
      });
    } else if (code === 'ERROR') {
      const login = body.error?.error_code === 'ITEM_LOGIN_REQUIRED';
      await this.prisma.plaidItem.update({
        where: { id: item.id },
        data: {
          status: login ? 'LOGIN_REQUIRED' : 'ERROR',
          error: reason('Your bank connection stopped working.'),
        },
      });
    }
  }
}
