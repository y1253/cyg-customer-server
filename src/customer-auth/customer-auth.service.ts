import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  CustomerAuthType,
  CustomerCreatedWith,
  type Customer,
} from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { ensureDefaultBook } from '../bookkeeping/books';
import { MailService } from '../mail/mail.service';
import {
  CODE_MAIL_PER_HOUR_DEFAULT,
  CodeMailLimiter,
  maskEmail,
} from './code-mail-limiter';
import { PrismaService } from '../prisma/prisma.service';
import { toE164 } from './phone-number.util';
import { buildPasswordCodeEmail } from './password-reset-email';
import {
  buildEmailConfirmCodeEmail,
  buildSignupCodeEmail,
} from './signup-code-email';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { GoogleLoginDto } from './dto/google-login.dto';
import type { LoginDto } from './dto/login.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { ResendSignupDto } from './dto/resend-signup.dto';
import type { SignupDto } from './dto/signup.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import type { VerifySignupDto } from './dto/verify-signup.dto';

/** Marks a token as a CUSTOMER token. The strategy refuses anything else. */
export const CUSTOMER_TOKEN_TYPE = 'customer';

export interface CustomerJwtPayload {
  sub: number;
  /** step12c: null for an account opened by phone that has not added an email. */
  email: string | null;
  name: string;
  typ: typeof CUSTOMER_TOKEN_TYPE;
  /** Issued-at, seconds — set by the JWT library. Compared with `passwordChangedAt`. */
  iat?: number;
}

/** The customer as the client sees it. Never carries `passwordHash`. */
export interface PublicCustomer {
  id: number;
  name: string;
  /** step12c: null for an account opened by phone that has not added an email yet. */
  email: string | null;
  authType: CustomerAuthType;
  /** step12c: where the account was opened (null = before step12c). */
  createdWith: CustomerCreatedWith | null;
  /** False for an account created through Google that never set a password. */
  hasPassword: boolean;
  avatarUrl: string | null;
  phone: string | null;
  /** EMAIL | WHATSAPP | SMS, or null when not chosen (step12). */
  preferredContact: string | null;
  createdAt: Date;
}

export interface AuthResult {
  access_token: string;
  customer: PublicCustomer;
}

/** What `verifyGoogleCredential` extracts from a verified Google ID token. */
export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

const BCRYPT_COST = 12;
export const AUTH_LIMIT = 5;
export const AUTH_WINDOW_MS = 15 * 60_000;

/** How long an emailed signup code stays valid. */
export const SIGNUP_CODE_TTL_MS = 10 * 60_000;
/** Wrong codes allowed before the pending signup is thrown away. */
export const SIGNUP_CODE_TRIES = 5;
/** Least time between two codes for the same email. */
export const SIGNUP_RESEND_MS = 60_000;

/** What `signup` answers: the account does not exist yet, a code was emailed. */
export interface SignupStarted {
  email: string;
}

/** An emailed 6-digit code waiting to be entered. Only its sha256 is kept. */
interface PendingCode {
  email: string;
  codeHash: Buffer;
  expiresAt: number;
  tries: number;
  sentAt: number;
}

/**
 * A signup waiting for its emailed code. The account is created only once the code checks
 * out, so an address nobody confirmed never gets a row. In memory: pm2 runs one fork, and a
 * restart losing a pending signup only means signing up again.
 */
interface PendingSignup extends PendingCode {
  name: string;
  passwordHash: string;
}

/** step12c: a code confirming an email added to a phone-opened account. */
interface PendingEmail extends PendingCode {
  customerId: number;
}

/** Which email a code goes out in. */
type CodeKind = 'signup' | 'password' | 'email';

/**
 * What to do when a code email is refused by the limits: tell the caller, or answer as if
 * it was sent. Forgot-password is SILENT so its answer never says whether an account
 * exists — and so a bot learns nothing from it.
 */
type OnLimit = 'throw' | 'silent';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 10_000;
const NOT_HUMAN = 'Please confirm you are human and try again.';

const sha256 = (code: string): Buffer =>
  createHash('sha256').update(code).digest();

const CODE_EXPIRED = 'This code has expired. Please sign up again.';
const RESET_EXPIRED = 'This code has expired. Please ask for a new one.';

/** step12c: a password signs in with the email, so an account opened by phone adds one first. */
const NEEDS_EMAIL =
  'Add an email to your account first — you sign in with your email and password';

/** One message for every password failure, so the response never says whether an email exists. */
const BAD_CREDENTIALS = 'Email or password is incorrect';

export function toPublicCustomer(c: Customer): PublicCustomer {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    authType: c.authType,
    createdWith: c.createdWith,
    hasPassword: c.passwordHash !== null,
    avatarUrl: c.avatarUrl,
    phone: c.phone,
    preferredContact: c.preferredContact,
    createdAt: c.createdAt,
  };
}

/**
 * Customer accounts for the public site. Entirely separate from staff auth: its own table,
 * its own secret (`CUSTOMER_JWT_SECRET`) and a `typ: 'customer'` claim, so a staff token can
 * never act as a customer or the reverse.
 *
 * Sessions are STATELESS: the JWT is the session and logging out is the client discarding
 * it. The guard still loads the customer on every request, so a deleted account stops
 * working at once.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);
  /** Failed logins + signups per IP, for the in-memory throttle. */
  private readonly hits = new Map<string, number[]>();
  /** Signups waiting for their emailed code, by lower-cased email. */
  private readonly pending = new Map<string, PendingSignup>();
  /** Password codes (forgot password, or a Google account setting one), by lower-cased email. */
  private readonly resets = new Map<string, PendingCode>();
  /** step12c: codes confirming an email being added, by lower-cased email. */
  private readonly emailCodes = new Map<string, PendingEmail>();
  private googleClient: OAuth2Client | null = null;
  /** Per-address and server-wide limits on code emails. */
  private readonly codeMails: CodeMailLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {
    const perHour = Number(this.config.get<string>('CODE_MAIL_MAX_PER_HOUR'));
    this.codeMails = new CodeMailLimiter(
      Number.isFinite(perHour) && perHour > 0
        ? perHour
        : CODE_MAIL_PER_HOUR_DEFAULT,
    );
  }

  /** The Turnstile site key for the browser widget. Null = the check is off. */
  turnstileSiteKey(): string | null {
    return this.config.get<string>('TURNSTILE_SITE_KEY')?.trim() || null;
  }

  /**
   * Cloudflare Turnstile ("are you human") on the routes that email a code to an address
   * the caller types. Off while `TURNSTILE_SECRET_KEY` is unset (dev). A missing or
   * rejected token is a 400. A transport failure lets the request through: a Cloudflare
   * outage must not close signup, and the code-mail limits still apply behind it.
   */
  async verifyHuman(token: string | undefined, ip: string): Promise<void> {
    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY')?.trim();
    if (!secret) return;
    if (!token) throw new BadRequestException(NOT_HUMAN);
    let ok: boolean;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip && ip !== 'unknown') body.set('remoteip', ip);
      const res = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      });
      const out = (await res.json()) as {
        success?: boolean;
        'error-codes'?: string[];
      };
      ok = out.success === true;
      if (!ok) {
        this.logger.warn(
          `turnstile rejected ip=${ip} codes=${(out['error-codes'] ?? []).join(',')}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `turnstile check failed, letting it through: ${(err as Error).message}`,
      );
      return;
    }
    if (!ok) throw new BadRequestException(NOT_HUMAN);
  }

  /** The Google client id, for the browser's Sign in with Google button. Null = not configured. */
  googleClientId(): string | null {
    return this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() || null;
  }

  /**
   * Step 1 of signup: check the email is free and email a 6-digit code. Nothing is written
   * to the database until `verifySignup`.
   */
  async signup(dto: SignupDto, ip: string): Promise<SignupStarted> {
    this.throttle(ip);
    this.note(ip);
    this.prunePending();
    const email = dto.email.toLowerCase();
    await this.assertEmailFree(email);
    const entry: PendingSignup = {
      name: dto.name,
      email,
      passwordHash: await hash(dto.password, BCRYPT_COST),
      codeHash: Buffer.alloc(0),
      expiresAt: 0,
      tries: 0,
      sentAt: 0,
    };
    this.pending.set(email, entry);
    await this.sendCode(entry, 'signup', ip);
    return { email };
  }

  /** Step 2 of signup: the emailed code is right → create the account and sign in. */
  async verifySignup(dto: VerifySignupDto, ip: string): Promise<AuthResult> {
    this.throttle(ip);
    const email = dto.email.toLowerCase();
    const entry = this.livePending(email);
    if (!timingSafeEqual(sha256(dto.code), entry.codeHash)) {
      this.note(ip);
      entry.tries += 1;
      if (entry.tries >= SIGNUP_CODE_TRIES) {
        this.pending.delete(email);
        throw new BadRequestException(
          'Too many wrong codes. Please sign up again.',
        );
      }
      throw new BadRequestException(
        'That code is not right. Please try again.',
      );
    }
    this.pending.delete(email);
    // The address may have been taken (e.g. Google sign-in) while the code was in the mail.
    await this.assertEmailFree(email);
    const customer = await this.prisma.customer.create({
      data: {
        name: entry.name,
        email,
        authType: CustomerAuthType.PASSWORD,
        createdWith: CustomerCreatedWith.WEB_EMAIL,
        passwordHash: entry.passwordHash,
        lastLoginAt: new Date(),
      },
    });
    await ensureDefaultBook(this.prisma, customer.id);
    return this.sign(customer);
  }

  /** A new code for a pending signup — at most one a minute. */
  async resendSignupCode(
    dto: ResendSignupDto,
    ip: string,
  ): Promise<SignupStarted> {
    const entry = this.livePending(dto.email.toLowerCase());
    if (Date.now() - entry.sentAt < SIGNUP_RESEND_MS) {
      throw new HttpException(
        'Please wait a minute before asking for another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.sendCode(entry, 'signup', ip);
    return { email: entry.email };
  }

  /** The pending signup for this email, or 400 when there is none or it has expired. */
  private livePending(email: string): PendingSignup {
    const entry = this.pending.get(email);
    if (!entry || entry.expiresAt < Date.now()) {
      this.pending.delete(email);
      throw new BadRequestException(CODE_EXPIRED);
    }
    return entry;
  }

  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(
        'An account with this email already exists — log in instead',
      );
    }
  }

  /**
   * Issues a fresh code (resetting tries and expiry) and emails it. A failed send drops the
   * pending entry, so a code nobody received can never be guessed at. Refused by the
   * code-mail limits, it throws or (`silent`) returns quietly.
   */
  private async sendCode(
    entry: PendingCode,
    kind: CodeKind,
    ip: string,
    onLimit: OnLimit = 'throw',
  ): Promise<void> {
    const store: Map<string, PendingCode> =
      kind === 'signup'
        ? this.pending
        : kind === 'email'
          ? this.emailCodes
          : this.resets;
    const verdict = this.codeMails.check(entry.email);
    if (verdict !== 'ok') {
      // Drop only an entry that never had a code. One already mailed stays usable, so a
      // bot asking again for somebody's address cannot cancel the code they are typing.
      if (entry.sentAt === 0) store.delete(entry.email);
      this.logger.warn(
        `${kind} code NOT sent (${verdict} limit) to=${maskEmail(entry.email)} ip=${ip}`,
      );
      if (onLimit === 'silent') return;
      if (verdict === 'address') {
        throw new HttpException(
          'Too many codes were sent to this email. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        'We cannot send emails right now. Please try again later.',
      );
    }
    this.codeMails.record(entry.email);
    this.logger.log(`${kind} code to=${maskEmail(entry.email)} ip=${ip}`);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    entry.codeHash = sha256(code);
    entry.expiresAt = Date.now() + SIGNUP_CODE_TTL_MS;
    entry.tries = 0;
    entry.sentAt = Date.now();
    if (
      this.config.get<string>('CUSTOMER_SIGNUP_LOG_CODE') === '1' &&
      process.env.NODE_ENV !== 'production'
    ) {
      // Dev only: SMTP is unreachable from the office network.
      this.logger.warn(`[dev] ${kind} code for ${entry.email}: ${code}`);
      return;
    }
    if (!this.mail.configured) {
      store.delete(entry.email);
      this.logger.error(
        `${kind} code not sent: SMTP_USER / SMTP_PASS are not set`,
      );
      throw new ServiceUnavailableException(
        kind === 'signup'
          ? 'We could not send the verification email right now. Please try again later.'
          : 'We could not send the email right now. Please try again later.',
      );
    }
    const minutes = SIGNUP_CODE_TTL_MS / 60_000;
    try {
      await this.mail.send({
        to: entry.email,
        fromName: 'CYG Finance',
        ...(kind === 'signup'
          ? buildSignupCodeEmail(code, minutes)
          : kind === 'email'
            ? buildEmailConfirmCodeEmail(code, minutes)
            : buildPasswordCodeEmail(code, minutes)),
      });
    } catch (err) {
      store.delete(entry.email);
      // The reason only — never the code.
      this.logger.error(`${kind} code mail failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        kind === 'signup'
          ? 'We could not send the verification email. Please check the address and try again.'
          : 'We could not send the email. Please try again later.',
      );
    }
  }

  private prunePending(): void {
    const now = Date.now();
    const stores: Map<string, PendingCode>[] = [
      this.pending,
      this.resets,
      this.emailCodes,
    ];
    for (const store of stores) {
      for (const [key, entry] of store) {
        if (entry.expiresAt < now) store.delete(key);
      }
    }
  }

  /**
   * Forgot password: emails a code to an existing account — with or without a password, so
   * a Google account can set one this way. Answers the same for an unknown address.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    ip: string,
  ): Promise<SignupStarted> {
    this.throttle(ip);
    this.note(ip);
    this.prunePending();
    const email = dto.email.toLowerCase();
    const customer = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (customer && !customer.deletedAt) {
      await this.issuePasswordCode(email, ip, 'silent');
    }
    return { email };
  }

  /** The emailed code is right → the new password is saved and the customer signed in. */
  async resetPassword(dto: ResetPasswordDto, ip: string): Promise<AuthResult> {
    this.throttle(ip);
    const email = dto.email.toLowerCase();
    this.checkPasswordCode(email, dto.code, ip);
    const customer = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (!customer || customer.deletedAt) {
      throw new BadRequestException(RESET_EXPIRED);
    }
    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...(await this.passwordData(dto.newPassword)),
        lastLoginAt: new Date(),
      },
    });
    return this.sign(updated);
  }

  /**
   * Change password from My account. An account with a password must give the current one;
   * one without (created through Google) gives the code from `sendPasswordCode`. Every other
   * device is signed out; the fresh token returned keeps this one in. A wrong current
   * password is a 400, never a 401 — the client treats 401 as "signed out".
   */
  async changePassword(
    customerId: number,
    dto: ChangePasswordDto,
    ip: string,
  ): Promise<AuthResult> {
    this.throttle(ip);
    const customer = await this.findActive(customerId);
    if (!customer) throw new UnauthorizedException();
    if (customer.passwordHash) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Enter your current password');
      }
      if (!(await compare(dto.currentPassword, customer.passwordHash))) {
        this.note(ip);
        throw new BadRequestException('Current password is incorrect');
      }
      if (dto.currentPassword === dto.newPassword) {
        throw new BadRequestException(
          'Choose a password different from your current one',
        );
      }
    } else {
      // A password signs in with the EMAIL — an account opened by phone adds one first.
      if (!customer.email) throw new BadRequestException(NEEDS_EMAIL);
      if (!dto.code) {
        throw new BadRequestException('Enter the 6-digit code from the email');
      }
      this.checkPasswordCode(customer.email, dto.code, ip);
    }
    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: await this.passwordData(dto.newPassword),
    });
    return this.sign(updated);
  }

  /** Emails a code to a signed-in account that has no password yet, to set one. */
  async sendPasswordCode(
    customerId: number,
    ip: string,
  ): Promise<SignupStarted> {
    const customer = await this.findActive(customerId);
    if (!customer) throw new UnauthorizedException();
    if (customer.passwordHash) {
      throw new BadRequestException(
        'Your account already has a password — enter it to change it',
      );
    }
    if (!customer.email) throw new BadRequestException(NEEDS_EMAIL);
    this.prunePending();
    await this.issuePasswordCode(customer.email, ip, 'throw');
    return { email: customer.email };
  }

  /**
   * step12c: emails a code to an address an account opened by phone wants to add. The address
   * must be free. Confirming it matters: Google sign-in finds accounts by email, so an
   * unconfirmed address would let one person claim another's Google login.
   */
  async sendEmailCode(
    customerId: number,
    rawEmail: string,
    ip: string,
  ): Promise<SignupStarted> {
    this.throttle(ip);
    const customer = await this.findActive(customerId);
    if (!customer) throw new UnauthorizedException();
    if (customer.email) {
      throw new BadRequestException('Your account already has an email');
    }
    const email = rawEmail.toLowerCase();
    await this.assertEmailFree(email);
    this.prunePending();
    const existing = this.emailCodes.get(email);
    if (existing && Date.now() - existing.sentAt < SIGNUP_RESEND_MS) {
      throw new HttpException(
        'Please wait a minute before asking for another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const entry: PendingEmail = {
      customerId,
      email,
      codeHash: Buffer.alloc(0),
      expiresAt: 0,
      tries: 0,
      sentAt: 0,
    };
    this.emailCodes.set(email, entry);
    await this.sendCode(entry, 'email', ip);
    return { email };
  }

  /** step12c: the emailed code is right → the address is the account's. */
  async verifyEmail(
    customerId: number,
    rawEmail: string,
    code: string,
    ip: string,
  ): Promise<PublicCustomer> {
    this.throttle(ip);
    const email = rawEmail.toLowerCase();
    const entry = this.emailCodes.get(email);
    if (
      !entry ||
      entry.customerId !== customerId ||
      entry.expiresAt < Date.now()
    ) {
      throw new BadRequestException(RESET_EXPIRED);
    }
    if (!timingSafeEqual(sha256(code), entry.codeHash)) {
      this.note(ip);
      entry.tries += 1;
      if (entry.tries >= SIGNUP_CODE_TRIES) {
        this.emailCodes.delete(email);
        throw new BadRequestException(
          'Too many wrong codes. Please ask for a new one.',
        );
      }
      throw new BadRequestException(
        'That code is not right. Please try again.',
      );
    }
    this.emailCodes.delete(email);
    await this.assertEmailFree(email);
    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { email },
    });
    return toPublicCustomer(updated);
  }

  /** A new password code for this email — at most one a minute. */
  private async issuePasswordCode(
    email: string,
    ip: string,
    onLimit: OnLimit,
  ): Promise<void> {
    const existing = this.resets.get(email);
    if (existing && Date.now() - existing.sentAt < SIGNUP_RESEND_MS) {
      throw new HttpException(
        'Please wait a minute before asking for another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const entry: PendingCode = existing ?? {
      email,
      codeHash: Buffer.alloc(0),
      expiresAt: 0,
      tries: 0,
      sentAt: 0,
    };
    this.resets.set(email, entry);
    await this.sendCode(entry, 'password', ip, onLimit);
  }

  /** Throws unless `code` is this email's live password code; a right code is used up. */
  private checkPasswordCode(email: string, code: string, ip: string): void {
    const entry = this.resets.get(email);
    if (!entry || entry.expiresAt < Date.now()) {
      this.resets.delete(email);
      throw new BadRequestException(RESET_EXPIRED);
    }
    if (!timingSafeEqual(sha256(code), entry.codeHash)) {
      this.note(ip);
      entry.tries += 1;
      if (entry.tries >= SIGNUP_CODE_TRIES) {
        this.resets.delete(email);
        throw new BadRequestException(
          'Too many wrong codes. Please ask for a new one.',
        );
      }
      throw new BadRequestException(
        'That code is not right. Please try again.',
      );
    }
    this.resets.delete(email);
  }

  /** The columns a new password writes. `passwordChangedAt` signs the other devices out. */
  private async passwordData(
    password: string,
  ): Promise<{ passwordHash: string; passwordChangedAt: Date }> {
    return {
      passwordHash: await hash(password, BCRYPT_COST),
      passwordChangedAt: new Date(),
    };
  }

  async login(dto: LoginDto, ip: string): Promise<AuthResult> {
    this.throttle(ip);
    const email = dto.email.toLowerCase();
    const customer = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (!customer || customer.deletedAt) {
      this.note(ip);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    if (!customer.passwordHash) {
      // Not a secret worth hiding: the person evidently owns the address and needs to know
      // which button to press.
      throw new UnauthorizedException('This account uses Sign in with Google');
    }
    if (!(await compare(dto.password, customer.passwordHash))) {
      this.note(ip);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    return this.issue(customer);
  }

  /**
   * Sign in with Google. The account is matched by EMAIL — Google has verified the address,
   * which is why `email_verified` is required — so an existing password account signs in
   * too, keeping its original `authType`. No provider id is stored.
   */
  async google(dto: GoogleLoginDto): Promise<AuthResult> {
    const identity = await this.verifyGoogleCredential(dto.credential);
    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Your Google account email is not verified',
      );
    }
    const email = identity.email.toLowerCase();
    const existing = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (existing?.deletedAt) {
      throw new UnauthorizedException('This account has been closed');
    }
    if (existing) {
      // Fill in a picture the account never had; never overwrite what the customer chose.
      if (!existing.avatarUrl && identity.picture) {
        const updated = await this.prisma.customer.update({
          where: { id: existing.id },
          data: { avatarUrl: identity.picture },
        });
        return this.issue(updated);
      }
      return this.issue(existing);
    }
    const created = await this.prisma.customer.create({
      data: {
        name: identity.name || email.split('@')[0],
        email,
        authType: CustomerAuthType.GOOGLE,
        createdWith: CustomerCreatedWith.GOOGLE,
        avatarUrl: identity.picture,
        lastLoginAt: new Date(),
      },
    });
    await ensureDefaultBook(this.prisma, created.id);
    return this.sign(created);
  }

  /** The signed-in customer, or null if the account is gone or closed. */
  async findActive(id: number): Promise<Customer | null> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    return customer && !customer.deletedAt ? customer : null;
  }

  async me(id: number): Promise<PublicCustomer> {
    const customer = await this.findActive(id);
    if (!customer) throw new UnauthorizedException();
    return toPublicCustomer(customer);
  }

  async updateMe(id: number, dto: UpdateMeDto): Promise<PublicCustomer> {
    const data: {
      name?: string;
      phone?: string | null;
      phoneE164?: string | null;
      preferredContact?: string | null;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) {
      data.phone = dto.phone || null;
      // What a text to an intake number is matched on (`IntakeSmsService`, internal API).
      data.phoneE164 = toE164(dto.phone);
      // step12c: a phone signs in (a texted code) and names ONE account's texts — never two.
      if (data.phoneE164 && (await this.phoneTaken(data.phoneE164, id))) {
        throw new BadRequestException(
          'This phone number is already on another CYG Finance account',
        );
      }
    }
    const before = await this.findActive(id);
    // An account opened by phone signs in with it: it cannot be removed until an email is added.
    if (before && !before.email && dto.phone !== undefined && !data.phoneE164) {
      throw new BadRequestException(
        'You sign in with this phone number — add an email before removing it',
      );
    }
    if (dto.preferredContact !== undefined) {
      data.preferredContact = dto.preferredContact;
    }
    // Text / WhatsApp need a phone to reach — the one saved now, or the one on file.
    const current = await this.prisma.customer.findUnique({ where: { id } });
    const method =
      dto.preferredContact !== undefined
        ? dto.preferredContact
        : current?.preferredContact;
    const phone = dto.phone !== undefined ? data.phone : current?.phone;
    if (
      (method === 'SMS' || method === 'WHATSAPP' || method === 'CALL') &&
      !phone
    )
      throw new BadRequestException(
        'Add your phone number to be contacted by text, WhatsApp or phone call',
      );
    const customer = await this.prisma.customer.update({
      where: { id },
      data,
    });
    return toPublicCustomer(customer);
  }

  /**
   * Verifies a Google ID token against our client id. Public so a test can replace it; the
   * real check is google-auth-library's — signature, issuer, audience and expiry.
   */
  async verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
    const clientId = this.googleClientId();
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Sign in with Google is not available right now',
      );
    }
    this.googleClient ??= new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn(
        `Google ID token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException(
        'Google sign-in failed — please try again',
      );
    }
    if (!payload?.email) {
      throw new UnauthorizedException('Google did not share an email address');
    }
    return {
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  }

  /** step12c: another live account already uses this phone (E.164). */
  async phoneTaken(phoneE164: string, exceptId?: number): Promise<boolean> {
    const other = await this.prisma.customer.findFirst({
      where: {
        phoneE164,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    return !!other;
  }

  /** Signs a customer in (a verified texted code, step12c). */
  issueFor(customer: Customer): Promise<AuthResult> {
    return this.issue(customer);
  }

  private async issue(customer: Customer): Promise<AuthResult> {
    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
    });
    return this.sign(updated);
  }

  private sign(customer: Customer): AuthResult {
    const payload: CustomerJwtPayload = {
      sub: customer.id,
      email: customer.email,
      name: customer.name,
      typ: CUSTOMER_TOKEN_TYPE,
    };
    return {
      access_token: this.jwt.sign(payload),
      customer: toPublicCustomer(customer),
    };
  }

  /** Refuses once an IP has failed (or signed up) `AUTH_LIMIT` times in the window. */
  throttle(ip: string): void {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter(
      (t) => now - t < AUTH_WINDOW_MS,
    );
    this.hits.set(ip, recent);
    if (recent.length >= AUTH_LIMIT) {
      throw new HttpException(
        'Too many attempts. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Counts one failure (or signup) of this IP toward `throttle`. */
  note(ip: string): void {
    const list = this.hits.get(ip) ?? [];
    list.push(Date.now());
    this.hits.set(ip, list);
    if (this.hits.size > 5000) {
      const cutoff = Date.now() - AUTH_WINDOW_MS;
      for (const [key, times] of this.hits) {
        if (!times.some((t) => t > cutoff)) this.hits.delete(key);
      }
    }
  }
}
