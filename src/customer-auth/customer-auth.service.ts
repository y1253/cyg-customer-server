import {
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
import { CustomerAuthType, type Customer } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import type { GoogleLoginDto } from './dto/google-login.dto';
import type { LoginDto } from './dto/login.dto';
import type { SignupDto } from './dto/signup.dto';
import type { UpdateMeDto } from './dto/update-me.dto';

/** Marks a token as a CUSTOMER token. The strategy refuses anything else. */
export const CUSTOMER_TOKEN_TYPE = 'customer';

export interface CustomerJwtPayload {
  sub: number;
  email: string;
  name: string;
  typ: typeof CUSTOMER_TOKEN_TYPE;
}

/** The customer as the client sees it. Never carries `passwordHash`. */
export interface PublicCustomer {
  id: number;
  name: string;
  email: string;
  authType: CustomerAuthType;
  avatarUrl: string | null;
  phone: string | null;
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

/** One message for every password failure, so the response never says whether an email exists. */
const BAD_CREDENTIALS = 'Email or password is incorrect';

export function toPublicCustomer(c: Customer): PublicCustomer {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    authType: c.authType,
    avatarUrl: c.avatarUrl,
    phone: c.phone,
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
  private googleClient: OAuth2Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** The Google client id, for the browser's Sign in with Google button. Null = not configured. */
  googleClientId(): string | null {
    return this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() || null;
  }

  async signup(dto: SignupDto, ip: string): Promise<AuthResult> {
    this.throttle(ip);
    this.note(ip);
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.customer.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(
        'An account with this email already exists — log in instead',
      );
    }
    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        email,
        authType: CustomerAuthType.PASSWORD,
        passwordHash: await hash(dto.password, BCRYPT_COST),
        lastLoginAt: new Date(),
      },
    });
    return this.sign(customer);
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
        avatarUrl: identity.picture,
        lastLoginAt: new Date(),
      },
    });
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
    const data: { name?: string; phone?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
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
  private throttle(ip: string): void {
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

  private note(ip: string): void {
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
