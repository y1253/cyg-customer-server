import * as crypto from 'crypto';

/** A Plaid webhook verification key (`/webhook_verification_key/get` → `key`). */
export interface PlaidJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  /** Unix seconds; set once Plaid retired the key. */
  expired_at?: number | null;
}

/** A webhook older than this is refused (Plaid's own recommendation: 5 minutes). */
export const MAX_AGE_SECONDS = 5 * 60;

function b64url(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** The `kid` of a `Plaid-Verification` JWT, or null when it is not an ES256 JWT. */
export function webhookKeyId(token: string): string | null {
  const [head] = token.split('.');
  try {
    const header = JSON.parse(b64url(head).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    return header.alg === 'ES256' && header.kid ? header.kid : null;
  } catch {
    return null;
  }
}

/**
 * Checks a Plaid webhook: the `Plaid-Verification` header is an ES256 JWT signed with the
 * key named by its `kid`, whose payload carries `iat` and the SHA-256 of the exact body.
 * Returns null when it is genuine, else the reason it is not.
 */
export function verifyPlaidWebhook(
  token: string,
  key: PlaidJwk,
  rawBody: Buffer,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return 'not a JWT';
  if (!webhookKeyId(token)) return 'not an ES256 token';
  if (key.expired_at) return 'key expired';

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({
      key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
      format: 'jwk',
    });
  } catch {
    return 'unusable key';
  }
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const ok = crypto.verify(
    'sha256',
    signed,
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    b64url(parts[2]),
  );
  if (!ok) return 'bad signature';

  let payload: { iat?: number; request_body_sha256?: string };
  try {
    payload = JSON.parse(b64url(parts[1]).toString('utf8')) as typeof payload;
  } catch {
    return 'unreadable payload';
  }
  if (
    typeof payload.iat !== 'number' ||
    nowSeconds - payload.iat > MAX_AGE_SECONDS
  ) {
    return 'too old';
  }
  const digest = crypto.createHash('sha256').update(rawBody).digest('hex');
  const claimed = String(payload.request_body_sha256 ?? '');
  if (
    claimed.length !== digest.length ||
    !crypto.timingSafeEqual(Buffer.from(claimed), Buffer.from(digest))
  ) {
    return 'body does not match';
  }
  return null;
}
