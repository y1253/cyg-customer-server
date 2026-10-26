import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerAuthType, CustomerCreatedWith } from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { ensureDefaultBook } from '../bookkeeping/books';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CODE_MAIL_PER_HOUR_DEFAULT,
  CodeMailLimiter,
} from './code-mail-limiter';
import {
  CustomerAuthService,
  SIGNUP_CODE_TRIES,
  SIGNUP_CODE_TTL_MS,
  SIGNUP_RESEND_MS,
  type AuthResult,
} from './customer-auth.service';
import { toE164 } from './phone-number.util';

/** A texted 6-digit login code waiting to be entered. Only its sha256 is kept. */
interface PendingPhoneCode {
  customerId: number;
  codeHash: Buffer;
  expiresAt: number;
  tries: number;
  sentAt: number;
}

/** What `requestCode` answers — the same whether or not the number has an account. */
export interface PhoneCodeSent {
  phone: string;
}

/** What `signupByPhone` did. */
export interface PhoneSignupResult {
  customerId: number;
  /** False = the phone was already on an account (nothing was created). */
  created: boolean;
}

const sha256 = (code: string): Buffer =>
  createHash('sha256').update(code).digest();

const EXPIRED = 'This code has expired. Please ask for a new one.';

/** "+15145551234" → "+1•••••••234", for logs. */
const maskPhone = (e164: string): string =>
  `${e164.slice(0, 2)}${'•'.repeat(Math.max(0, e164.length - 5))}${e164.slice(-3)}`;

/**
 * step12c (user's request: "a customer should be able to sign up by text… later login with
 * phone number and system sends verification code"):
 *
 * - **Phone login** — anyone whose account has a phone signs in with a 6-digit code texted to
 *   it (`CustomerMessenger`, from a receipt number). Codes live in memory with the email-code
 *   rules (sha256, 10 min, 5 wrong tries, ≥ 60 s apart) and the `CodeMailLimiter` per number
 *   and server-wide. Asking answers the same for a number with no account. A number on two
 *   accounts gets no code (`updateMe` stops new duplicates).
 * - **Signup by phone** — the internal API, after an unknown number replied YES to the
 *   texted offer, opens an account on that number (`authType PHONE`, no email, no password,
 *   `createdWith` SMS / WHATSAPP / CALL) with its first book, "Company1".
 *
 * Dev: `CUSTOMER_SIGNUP_LOG_CODE=1` logs the code instead of texting it (never in production).
 */
@Injectable()
export class PhoneAuthService {
  private readonly logger = new Logger(PhoneAuthService.name);
  /** Login codes by E.164 number. */
  private readonly codes = new Map<string, PendingPhoneCode>();
  private readonly limiter: CodeMailLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: CustomerAuthService,
    private readonly messenger: CustomerMessenger,
  ) {
    const perHour = Number(this.config.get<string>('CODE_MAIL_MAX_PER_HOUR'));
    this.limiter = new CodeMailLimiter(
      Number.isFinite(perHour) && perHour > 0
        ? perHour
        : CODE_MAIL_PER_HOUR_DEFAULT,
    );
  }

  /** Texts a login code to the number's account, if it has exactly one. */
  async requestCode(rawPhone: string, ip: string): Promise<PhoneCodeSent> {
    this.auth.throttle(ip);
    this.auth.note(ip);
    const phone = this.parse(rawPhone);
    this.prune();
    const accounts = await this.prisma.customer.findMany({
      where: { phoneE164: phone, deletedAt: null },
      select: { id: true },
      take: 2,
    });
    if (accounts.length !== 1) {
      this.logger.log(
        `login code NOT sent to=${maskPhone(phone)} ip=${ip} (${accounts.length ? 'several accounts' : 'no account'})`,
      );
      return { phone };
    }
    const existing = this.codes.get(phone);
    if (existing && Date.now() - existing.sentAt < SIGNUP_RESEND_MS) {
      throw new HttpException(
        'Please wait a minute before asking for another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const verdict = this.limiter.check(phone);
    if (verdict !== 'ok') {
      this.logger.warn(
        `login code NOT sent (${verdict} limit) to=${maskPhone(phone)} ip=${ip}`,
      );
      if (verdict === 'address') {
        throw new HttpException(
          'Too many codes were sent to this number. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        'We cannot send texts right now. Please try again later.',
      );
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const entry: PendingPhoneCode = {
      customerId: accounts[0].id,
      codeHash: sha256(code),
      expiresAt: Date.now() + SIGNUP_CODE_TTL_MS,
      tries: 0,
      sentAt: Date.now(),
    };
    this.limiter.record(phone);
    this.logger.log(`login code to=${maskPhone(phone)} ip=${ip}`);
    if (
      this.config.get<string>('CUSTOMER_SIGNUP_LOG_CODE') === '1' &&
      process.env.NODE_ENV !== 'production'
    ) {
      this.logger.warn(`[dev] login code for ${phone}: ${code}`);
      this.codes.set(phone, entry);
      return { phone };
    }
    const outcome = await this.messenger.send({
      channel: 'SMS',
      to: phone,
      body: `${code} is your CYG Finance login code. It expires in ${SIGNUP_CODE_TTL_MS / 60_000} minutes. Don't share it with anyone.`,
      meta: { customerId: entry.customerId, purpose: 'LOGIN_CODE' },
    });
    if (outcome === 'opted-out') {
      throw new BadRequestException(
        'This number texted STOP to us, so we cannot text it a code. Text START to our number, then try again.',
      );
    }
    if (outcome !== 'sent') {
      this.logger.error(`login code text ${outcome} to=${maskPhone(phone)}`);
      throw new ServiceUnavailableException(
        'We could not text you a code right now. Please try again later.',
      );
    }
    this.codes.set(phone, entry);
    return { phone };
  }

  /** The texted code is right → signed in. */
  async verifyCode(
    rawPhone: string,
    code: string,
    ip: string,
  ): Promise<AuthResult> {
    this.auth.throttle(ip);
    const phone = this.parse(rawPhone);
    const entry = this.codes.get(phone);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(phone);
      throw new BadRequestException(EXPIRED);
    }
    if (!timingSafeEqual(sha256(code), entry.codeHash)) {
      this.auth.note(ip);
      entry.tries += 1;
      if (entry.tries >= SIGNUP_CODE_TRIES) {
        this.codes.delete(phone);
        throw new BadRequestException(
          'Too many wrong codes. Please ask for a new one.',
        );
      }
      throw new BadRequestException(
        'That code is not right. Please try again.',
      );
    }
    this.codes.delete(phone);
    const customer = await this.auth.findActive(entry.customerId);
    // The phone may have moved off the account while the code was out.
    if (!customer || customer.phoneE164 !== phone) {
      throw new BadRequestException(EXPIRED);
    }
    return this.auth.issueFor(customer);
  }

  /**
   * Opens an account on a phone that accepted the texted offer. A phone already on an
   * account opens nothing (`created: false`, that account's id).
   */
  async signupByPhone(
    rawPhone: string,
    createdWith: 'SMS' | 'WHATSAPP' | 'CALL',
  ): Promise<PhoneSignupResult> {
    const phone = this.parse(rawPhone);
    const existing = await this.prisma.customer.findFirst({
      where: { phoneE164: phone, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (existing) {
      await this.linkProspect(phone, existing.id);
      return { customerId: existing.id, created: false };
    }
    const customer = await this.prisma.customer.create({
      data: {
        name: '',
        email: null,
        authType: CustomerAuthType.PHONE,
        createdWith: CustomerCreatedWith[createdWith],
        phone,
        phoneE164: phone,
        // They reached us on this channel; a call's offer was answered by text.
        preferredContact: createdWith === 'WHATSAPP' ? 'WHATSAPP' : 'SMS',
      },
    });
    await ensureDefaultBook(this.prisma, customer.id);
    await this.linkProspect(phone, customer.id);
    this.logger.log(
      `account #${customer.id} opened by ${createdWith} for ${maskPhone(phone)}`,
    );
    return { customerId: customer.id, created: true };
  }

  /** step12f: the AI salesperson's conversation with this phone now points at its account. */
  private async linkProspect(phone: string, customerId: number): Promise<void> {
    try {
      await this.prisma.prospect.updateMany({
        where: { phoneE164: phone, customerId: null },
        data: { customerId, signedUpAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`prospect link failed: ${String(err)}`);
    }
  }

  private parse(raw: string): string {
    const phone = toE164(raw);
    if (!phone) {
      throw new BadRequestException(
        'Enter a valid phone number (with the country code if outside Canada / the US)',
      );
    }
    return phone;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(key);
    }
  }
}
