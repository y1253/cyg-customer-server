import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CustomerAuthType, type Customer } from '@prisma/client';
import { hash } from 'bcryptjs';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AUTH_LIMIT,
  CustomerAuthService,
  SIGNUP_CODE_TRIES,
  SIGNUP_CODE_TTL_MS,
  SIGNUP_RESEND_MS,
  type GoogleIdentity,
} from './customer-auth.service';
import { CustomerJwtStrategy } from './customer-jwt.strategy';

const SECRET = 'test-customer-secret';
const IP = '1.2.3.4';

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: 'Ana Lopez',
    email: 'ana@example.com',
    authType: CustomerAuthType.PASSWORD,
    passwordHash: null,
    avatarUrl: null,
    phone: null,
    phoneE164: null,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    lastLoginAt: null,
    deletedAt: null,
    salesTaxEnabled: false,
    taxStale: false,
    taxRunningSince: null,
    stripeCustomerId: null,
    ...over,
  };
}

function setup(existing: Customer | null = null) {
  const prisma = {
    customer: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn(({ data }: { data: Partial<Customer> }) =>
        Promise.resolve(customer({ id: 2, ...data })),
      ),
      update: jest.fn(({ data }: { data: Partial<Customer> }) =>
        Promise.resolve({ ...(existing ?? customer()), ...data }),
      ),
    },
  };
  const env: Record<string, string> = {
    CUSTOMER_JWT_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  };
  const config = {
    get: (k: string) => env[k],
    getOrThrow: (k: string) => env[k],
  } as unknown as ConfigService;
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '7d' },
  });
  const mail = {
    configured: true,
    send: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CustomerAuthService(
    prisma as unknown as PrismaService,
    jwt,
    config,
    mail as unknown as MailService,
  );
  const google = (identity: Partial<GoogleIdentity>) =>
    jest.spyOn(service, 'verifyGoogleCredential').mockResolvedValue({
      email: 'ana@example.com',
      emailVerified: true,
      name: 'Ana Lopez',
      picture: 'https://lh3.googleusercontent.com/a/pic',
      ...identity,
    });
  const strategy = new CustomerJwtStrategy(config, service);
  return { service, prisma, jwt, google, strategy, mail };
}

const SIGNUP = {
  name: 'Ana',
  email: 'Ana@Example.com',
  password: 'longenough',
};

/** The code out of the last mail sent. */
function sentCode(mail: { send: jest.Mock }): string {
  const calls = mail.send.mock.calls as [{ text: string }][];
  const text = calls[calls.length - 1][0].text;
  return /code is: (\d{6})/.exec(text)![1];
}

describe('signup', () => {
  afterEach(() => jest.useRealTimers());

  it('emails a 6-digit code and creates no account yet', async () => {
    const { service, prisma, mail } = setup();
    const out = await service.signup(SIGNUP, IP);
    expect(out).toEqual({ email: 'ana@example.com' });
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@example.com' }),
    );
    expect(sentCode(mail)).toMatch(/^\d{6}$/);
  });

  it('creates the PASSWORD account once the right code is entered', async () => {
    const { service, prisma, mail, jwt } = setup();
    await service.signup(SIGNUP, IP);
    const out = await service.verifySignup(
      { email: 'ANA@example.com', code: sentCode(mail) },
      IP,
    );
    const data = prisma.customer.create.mock.calls[0][0].data;
    expect(data.email).toBe('ana@example.com');
    expect(data.authType).toBe(CustomerAuthType.PASSWORD);
    expect(data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(out.customer).not.toHaveProperty('passwordHash');
    expect(jwt.verify(out.access_token)).toMatchObject({
      sub: 2,
      typ: 'customer',
    });
    // Used up: the same code cannot create a second account.
    await expect(
      service.verifySignup(
        { email: 'ana@example.com', code: sentCode(mail) },
        IP,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a wrong code and drops the signup after the last try', async () => {
    const { service, prisma, mail } = setup();
    await service.signup(SIGNUP, IP);
    const right = sentCode(mail);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 1; i < SIGNUP_CODE_TRIES; i++) {
      await expect(
        service.verifySignup(
          { email: 'ana@example.com', code: wrong },
          '9.9.9.' + i,
        ),
      ).rejects.toThrow('not right');
    }
    await expect(
      service.verifySignup(
        { email: 'ana@example.com', code: wrong },
        '9.9.9.9',
      ),
    ).rejects.toThrow('Too many wrong codes');
    await expect(
      service.verifySignup(
        { email: 'ana@example.com', code: right },
        '9.9.9.10',
      ),
    ).rejects.toThrow('expired');
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it('refuses an expired code', async () => {
    jest.useFakeTimers();
    const { service, mail } = setup();
    await service.signup(SIGNUP, IP);
    jest.advanceTimersByTime(SIGNUP_CODE_TTL_MS + 1);
    await expect(
      service.verifySignup(
        { email: 'ana@example.com', code: sentCode(mail) },
        IP,
      ),
    ).rejects.toThrow('expired');
  });

  it('resends at most once a minute, and only the newest code works', async () => {
    jest.useFakeTimers();
    const { service, mail } = setup();
    await service.signup(SIGNUP, IP);
    await expect(
      service.resendSignupCode({ email: 'ana@example.com' }),
    ).rejects.toBeInstanceOf(HttpException);
    jest.advanceTimersByTime(SIGNUP_RESEND_MS);
    await service.resendSignupCode({ email: 'ana@example.com' });
    expect(mail.send).toHaveBeenCalledTimes(2);
    const out = await service.verifySignup(
      { email: 'ana@example.com', code: sentCode(mail) },
      IP,
    );
    expect(out.customer.email).toBe('ana@example.com');
  });

  it('answers 503 and keeps nothing when the email cannot be sent', async () => {
    const { service, mail } = setup();
    mail.send.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.signup(SIGNUP, IP)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      service.resendSignupCode({ email: 'ana@example.com' }),
    ).rejects.toThrow('expired');
  });

  it('refuses an email that already has an account with 409', async () => {
    const { service, mail } = setup(customer());
    await expect(service.signup(SIGNUP, IP)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('refuses with 409 when the email was taken while the code was in the mail', async () => {
    const { service, prisma, mail } = setup();
    await service.signup(SIGNUP, IP);
    prisma.customer.findUnique.mockResolvedValueOnce(customer());
    await expect(
      service.verifySignup(
        { email: 'ana@example.com', code: sentCode(mail) },
        IP,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('signs in with the right password', async () => {
    const { service } = setup(
      customer({ passwordHash: await hash('correct-horse', 4) }),
    );
    const out = await service.login(
      { email: 'ANA@example.com', password: 'correct-horse' },
      IP,
    );
    expect(out.customer.email).toBe('ana@example.com');
  });

  it('answers the SAME generic 401 for a wrong password and an unknown email', async () => {
    const wrong = setup(
      customer({ passwordHash: await hash('correct-horse', 4) }),
    );
    const unknown = setup(null);
    await expect(
      wrong.service.login(
        { email: 'ana@example.com', password: 'nope-nope' },
        IP,
      ),
    ).rejects.toThrow('Email or password is incorrect');
    await expect(
      unknown.service.login(
        { email: 'who@example.com', password: 'nope-nope' },
        IP,
      ),
    ).rejects.toThrow('Email or password is incorrect');
  });

  it('tells a Google account to use the Google button', async () => {
    const { service } = setup(customer({ authType: CustomerAuthType.GOOGLE }));
    await expect(
      service.login({ email: 'ana@example.com', password: 'whatever1' }, IP),
    ).rejects.toThrow('This account uses Sign in with Google');
  });

  it('throttles an IP after repeated failures', async () => {
    const { service } = setup(null);
    for (let i = 0; i < AUTH_LIMIT; i++) {
      await service
        .login({ email: 'who@example.com', password: 'nope-nope' }, IP)
        .catch(() => undefined);
    }
    await expect(
      service.login({ email: 'who@example.com', password: 'nope-nope' }, IP),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('google', () => {
  it('creates a GOOGLE account with no password for a new email', async () => {
    const { service, prisma, google } = setup(null);
    google({});
    await service.google({ credential: 'id-token' });
    const data = prisma.customer.create.mock.calls[0][0].data;
    expect(data.authType).toBe(CustomerAuthType.GOOGLE);
    expect(data.passwordHash).toBeUndefined();
    expect(data.avatarUrl).toBe('https://lh3.googleusercontent.com/a/pic');
  });

  it('signs into an existing PASSWORD account with the same email, keeping its authType', async () => {
    const { service, prisma, google } = setup(
      customer({ avatarUrl: 'mine.png' }),
    );
    google({});
    const out = await service.google({ credential: 'id-token' });
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(out.customer.id).toBe(1);
    expect(out.customer.authType).toBe(CustomerAuthType.PASSWORD);
    expect(out.customer.avatarUrl).toBe('mine.png');
  });

  it('refuses a Google email that is not verified', async () => {
    const { service, google } = setup(null);
    google({ emailVerified: false });
    await expect(
      service.google({ credential: 'id-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('CustomerJwtStrategy', () => {
  it('accepts a customer token for an active customer', async () => {
    const { strategy } = setup(customer());
    await expect(
      strategy.validate({ sub: 1, typ: 'customer', email: 'a', name: 'b' }),
    ).resolves.toEqual({ customerId: 1 });
  });

  it('refuses a token without typ "customer" (e.g. a staff token shape)', async () => {
    const { strategy } = setup(customer());
    await expect(strategy.validate({ sub: 1 } as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a deleted customer's token", async () => {
    const { strategy } = setup(customer({ deletedAt: new Date() }));
    await expect(
      strategy.validate({ sub: 1, typ: 'customer', email: 'a', name: 'b' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
