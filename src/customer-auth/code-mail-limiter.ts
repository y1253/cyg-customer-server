/** Least time between two code emails to the same address. */
export const CODE_MAIL_GAP_MS = 60_000;
/** Code emails one address may receive in `CODE_MAIL_DAY_MS`. */
export const CODE_MAIL_PER_ADDRESS = 5;
export const CODE_MAIL_DAY_MS = 24 * 60 * 60_000;
/** Default cap on code emails from the whole server per hour (`CODE_MAIL_MAX_PER_HOUR`). */
export const CODE_MAIL_PER_HOUR_DEFAULT = 30;
const HOUR_MS = 60 * 60_000;

/** Why a code email may not go out: too soon/too many for this address, or for the server. */
export type CodeMailVerdict = 'ok' | 'address' | 'global';

/**
 * Limits on the 6-digit code emails (signup, forgot password, set password).
 *
 * The per-IP throttle cannot stop these on its own: in Oct 2026 a bot posted signup and
 * forgot-password from rotating IPs and Tor exits — 173 signups in one day — and every one
 * mailed a code. So the limit is also per ADDRESS (protects the person being mailed) and
 * GLOBAL (protects the Gmail account that sends them). In memory: pm2 runs one fork.
 */
export class CodeMailLimiter {
  private readonly byAddress = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private readonly perHour: number = CODE_MAIL_PER_HOUR_DEFAULT,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(email: string): CodeMailVerdict {
    const t = this.now();
    const sent = this.recent(email, t);
    if (
      sent.length >= CODE_MAIL_PER_ADDRESS ||
      (sent.length > 0 && t - sent[sent.length - 1] < CODE_MAIL_GAP_MS)
    ) {
      return 'address';
    }
    this.global = this.global.filter((s) => t - s < HOUR_MS);
    if (this.global.length >= this.perHour) return 'global';
    return 'ok';
  }

  /** Count one email to `email`. Call only after `check` said 'ok'. */
  record(email: string): void {
    const t = this.now();
    this.byAddress.set(email, [...this.recent(email, t), t]);
    this.global.push(t);
  }

  private recent(email: string, t: number): number[] {
    const sent = (this.byAddress.get(email) ?? []).filter(
      (s) => t - s < CODE_MAIL_DAY_MS,
    );
    if (sent.length) this.byAddress.set(email, sent);
    else this.byAddress.delete(email);
    return sent;
  }
}

/** `c***@cygfinance.com` — enough to see who is being targeted, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}
