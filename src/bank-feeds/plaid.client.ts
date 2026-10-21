import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Plaid's error body (`error_type`, `error_code`, …) as a thrown error. */
export class PlaidApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly code: string,
    message: string,
    /** Plaid's end-user wording, when it gave one. */
    readonly displayMessage: string | null,
  ) {
    super(message);
  }
}

/** The fields of a Plaid account this app reads (`/accounts/get`, `/transactions/sync`). */
export interface PlaidAccountData {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
}

/** The fields of a Plaid transaction this app reads. */
export interface PlaidTransactionData {
  transaction_id: string;
  account_id: string;
  /** Positive = money OUT of the account. */
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  /** YYYY-MM-DD — the posted date (the transaction date while pending). */
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  personal_finance_category?: { primary: string; detailed: string } | null;
}

/**
 * Plaid over plain HTTPS (`fetch`) — no SDK, so nothing to install on the host. Built
 * lazily like `StripeClient`: the server starts without keys and a bank-feed route then
 * answers 503. `PLAID_ENV` = sandbox | production.
 */
@Injectable()
export class PlaidClient {
  constructor(private readonly config: ConfigService) {}

  private get(name: string): string {
    return this.config.get<string>(name)?.trim() ?? '';
  }

  get configured(): boolean {
    return Boolean(this.get('PLAID_CLIENT_ID') && this.get('PLAID_SECRET'));
  }

  get env(): string {
    return this.get('PLAID_ENV') || 'sandbox';
  }

  get webhookUrl(): string | null {
    return this.get('PLAID_WEBHOOK_URL') || null;
  }

  /** Optional: needed only for banks that sign in through their own site (OAuth). */
  get redirectUri(): string | null {
    return this.get('PLAID_REDIRECT_URI') || null;
  }

  get countryCodes(): string[] {
    const raw = this.get('PLAID_COUNTRY_CODES') || 'CA,US';
    return raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }

  /** POST one Plaid endpoint with the keys added. Throws `PlaidApiError` on a Plaid error. */
  async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Bank connections are not set up yet — please contact us.',
      );
    }
    const host = HOSTS[this.env];
    if (!host)
      throw new Error(
        `PLAID_ENV must be sandbox or production, not "${this.env}"`,
      );
    const res = await fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.get('PLAID_CLIENT_ID'),
        secret: this.get('PLAID_SECRET'),
        ...body,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      throw new PlaidApiError(
        res.status,
        text(json.error_type) ?? 'API_ERROR',
        text(json.error_code) ?? `HTTP_${res.status}`,
        text(json.error_message) ?? `Plaid ${path} answered ${res.status}`,
        typeof json.display_message === 'string' ? json.display_message : null,
      );
    }
    return json as T;
  }
}
