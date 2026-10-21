import * as crypto from 'crypto';

/**
 * AES-256-CBC, the same format as the internal app's `common/crypto.ts` (`ivHex:cipherHex`,
 * `ENCRYPTION_KEY` = 64 hex chars), so either API can read what the other stored.
 * Used for Plaid access tokens — they never sit in the database in plain text.
 */
const ALGORITHM = 'aes-256-cbc';

function keyOf(keyHex: string): Buffer {
  const key = Buffer.from(keyHex.trim(), 'hex');
  if (key.length !== 32)
    throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  return key;
}

export function encrypt(text: string, keyHex: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, keyOf(keyHex), iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(text: string, keyHex: string): string {
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    keyOf(keyHex),
    Buffer.from(ivHex, 'hex'),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
