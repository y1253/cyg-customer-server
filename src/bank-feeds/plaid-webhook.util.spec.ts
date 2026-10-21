import * as crypto from 'crypto';
import {
  verifyPlaidWebhook,
  webhookKeyId,
  type PlaidJwk,
} from './plaid-webhook.util';

const b64url = (b: Buffer) =>
  b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** A local P-256 key standing in for Plaid's, and a signer for test tokens. */
function setup() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as PlaidJwk;
  const sign = (
    payload: object,
    header: object = { alg: 'ES256', kid: 'k1', typ: 'JWT' },
  ) => {
    const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
    const sig = crypto.sign('sha256', Buffer.from(input), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `${input}.${b64url(sig)}`;
  };
  return { jwk, sign };
}

const body = Buffer.from(
  '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}',
);
const sha = crypto.createHash('sha256').update(body).digest('hex');
const now = 1_800_000_000;

describe('verifyPlaidWebhook', () => {
  it('accepts a genuine webhook', () => {
    const { jwk, sign } = setup();
    const token = sign({ iat: now - 10, request_body_sha256: sha });
    expect(webhookKeyId(token)).toBe('k1');
    expect(verifyPlaidWebhook(token, jwk, body, now)).toBeNull();
  });

  it('refuses a tampered body', () => {
    const { jwk, sign } = setup();
    const token = sign({ iat: now, request_body_sha256: sha });
    expect(
      verifyPlaidWebhook(
        token,
        jwk,
        Buffer.from('{"webhook_type":"ITEM"}'),
        now,
      ),
    ).toBe('body does not match');
  });

  it('refuses a token signed with another key', () => {
    const { sign } = setup();
    const other = setup().jwk;
    const token = sign({ iat: now, request_body_sha256: sha });
    expect(verifyPlaidWebhook(token, other, body, now)).toBe('bad signature');
  });

  it('refuses an old webhook', () => {
    const { jwk, sign } = setup();
    const token = sign({ iat: now - 301, request_body_sha256: sha });
    expect(verifyPlaidWebhook(token, jwk, body, now)).toBe('too old');
  });

  it('refuses anything but ES256', () => {
    const { jwk, sign } = setup();
    const token = sign(
      { iat: now, request_body_sha256: sha },
      { alg: 'HS256', kid: 'k1' },
    );
    expect(webhookKeyId(token)).toBeNull();
    expect(verifyPlaidWebhook(token, jwk, body, now)).toBe(
      'not an ES256 token',
    );
  });

  it('refuses a retired key', () => {
    const { jwk, sign } = setup();
    const token = sign({ iat: now, request_body_sha256: sha });
    expect(
      verifyPlaidWebhook(token, { ...jwk, expired_at: now - 1 }, body, now),
    ).toBe('key expired');
  });
});
