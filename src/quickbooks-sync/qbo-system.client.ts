import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** The claim the internal API's `QboSystemGuard` accepts — one company per token. */
export const QBO_SYSTEM_TOKEN_TYPE = 'qbo-system';

/** A refused or failed QuickBooks call, with the internal API's status and message. */
export class QboCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Entity = 'Account' | 'Customer' | 'Deposit' | 'Employee' | 'Purchase' | 'Vendor';

/**
 * step11 (internal, 2026-11-23): QuickBooks calls go through the INTERNAL API, which owns the
 * tokens (Intuit rotates the refresh token, so only one server may refresh it). This side
 * signs a 60 s `qbo-system` JWT on the shared `CUSTOMER_JWT_SECRET` for one company and
 * calls `INTERNAL_API_URL/qbo-system/companies/:companyId/*`.
 */
@Injectable()
export class QboSystemClient {
  private readonly jwt: JwtService;

  constructor(private readonly config: ConfigService) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  query<T = Record<string, unknown>>(companyId: number, query: string): Promise<T> {
    return this.post<T>(companyId, 'query', { query });
  }

  create(companyId: number, entity: Entity, body: Record<string, unknown>) {
    return this.post<Record<string, { Id?: string } | undefined>>(
      companyId,
      'create',
      { entity, body },
    );
  }

  update(
    companyId: number,
    entity: Entity,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.post<Record<string, { Id?: string } | undefined>>(
      companyId,
      'update',
      { entity, id, body },
    );
  }

  remove(companyId: number, entity: 'Purchase' | 'Deposit', id: string) {
    return this.post(companyId, 'remove', { entity, id });
  }

  private async post<T>(
    companyId: number,
    path: string,
    body: unknown,
  ): Promise<T> {
    const base = (
      this.config.get<string>('INTERNAL_API_URL') ?? 'http://localhost:3000/api'
    ).replace(/\/+$/, '');
    const token = this.jwt.sign(
      { typ: QBO_SYSTEM_TOKEN_TYPE, companyId },
      { expiresIn: '60s' },
    );
    let res: Response;
    try {
      res = await fetch(`${base}/qbo-system/companies/${companyId}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      throw new QboCallError(0, `The internal API is unreachable: ${String(err)}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const message =
        (json as { message?: unknown })?.message ?? `HTTP ${res.status}`;
      throw new QboCallError(
        res.status,
        Array.isArray(message) ? message.join('; ') : String(message),
      );
    }
    return json as T;
  }
}
