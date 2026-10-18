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
    passwordChangedAt: null,
    avatarUrl: null,
    phone: null,
    phoneE164: null,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    lastLoginAt: null,
    deletedAt: null,
    salesTaxEnabled: false,
    homeCurrency: 'CAD',
    taxStale: false,
    taxRunningSince: null,
    stripeCustomerId: null,
    ...over,
  };
}

function setup(
  existing: Customer | null = null,
  extraEnv: Record<string, string> = {},
) {
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
    ...extraEnv,
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
      service.resendSignupCode({ email: 'ana@example.com' }, IP),
    ).rejects.toBeInstanceOf(HttpException);
    jest.advanceTimersByTime(SIGNUP_RESEND_MS);
    await service.resendSignupCode({ email: 'ana@example.com' }, IP);
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
      service.resendSignupCode({ email: 'ana@example.com' }, IP),
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

describe('forgot / reset password', () => {
  afterEach(() => jest.useRealTimers());

  it('emails a code, and the code sets the new password and signs in', async () => {
    const { service, prisma, mail, jwt } = setup(
      customer({ passwordHash: await hash('old-password', 4) }),
    );
    const out = await service.forgotPassword({ email: 'ANA@example.com' }, IP);
    expect(out).toEqual({ email: 'ana@example.com' });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@example.com' }),
    );
    const done = await service.resetPassword(
      {
        email: 'ana@example.com',
        code: sentCode(mail),
        newPassword: 'brand-new-pw',
      },
      IP,
    );
    const data = prisma.customer.update.mock.calls[0][0].data;
    expect(data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(jwt.verify(done.access_token)).toMatchObject({ sub: 1 });
    // Used up.
    await expect(
      service.resetPassword(
        {
          email: 'ana@example.com',
          code: sentCode(mail),
          newPassword: 'another-pw-1',
        },
        IP,
      ),
    ).rejects.toThrow('expired');
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const { service, mail } = setup(null);
    await expect(
      service.forgotPassword({ email: 'who@example.com' }, IP),
    ).resolves.toEqual({ email: 'who@example.com' });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('lets a Google account (no password) set one this way', async () => {
    const { service, prisma, mail } = setup(
      customer({ authType: CustomerAuthType.GOOGLE }),
    );
    await service.forgotPassword({ email: 'ana@example.com' }, IP);
    const done = await service.resetPassword(
      {
        email: 'ana@example.com',
        code: sentCode(mail),
        newPassword: 'brand-new-pw',
      },
      IP,
    );
    expect(prisma.customer.update.mock.calls[0][0].data.passwordHash).toEqual(
      expect.any(String),
    );
    expect(done.customer.hasPassword).toBe(true);
    expect(done.customer.authType).toBe(CustomerAuthType.GOOGLE);
  });

  it('refuses wrong codes, then drops the code after the last try', async () => {
    const { service, prisma, mail } = setup(customer());
    await service.forgotPassword({ email: 'ana@example.com' }, IP);
    const right = sentCode(mail);
    const wrong = right === '000000' ? '111111' : '000000';
    const reset = (code: string, ip: string) =>
      service.resetPassword(
        { email: 'ana@example.com', code, newPassword: 'brand-new-pw' },
        ip,
      );
    for (let i = 1; i < SIGNUP_CODE_TRIES; i++) {
      await expect(reset(wrong, '9.9.9.' + i)).rejects.toThrow('not right');
    }
    await expect(reset(wrong, '9.9.9.9')).rejects.toThrow(
      'Too many wrong codes',
    );
    await expect(reset(right, '9.9.9.10')).rejects.toThrow('expired');
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('refuses an expired code, and a second code within a minute', async () => {
    jest.useFakeTimers();
    const { service, mail } = setup(customer());
    await service.forgotPassword({ email: 'ana@example.com' }, IP);
    await expect(
      service.forgotPassword({ email: 'ana@example.com' }, IP),
    ).rejects.toMatchObject({ status: 429 });
    jest.advanceTimersByTime(SIGNUP_CODE_TTL_MS + 1);
    await expect(
      service.resetPassword(
        {
          email: 'ana@example.com',
          code: sentCode(mail),
          newPassword: 'brand-new-pw',
        },
        IP,
      ),
    ).rejects.toThrow('expired');
  });
});

describe('changePassword', () => {
  it('needs the right current password — a wrong one is 400, never 401', async () => {
    const { service, prisma } = setup(
      customer({ passwordHash: await hash('old-password', 4) }),
    );
    await expect(
      service.changePassword(
        1,
        { currentPassword: 'not-it-at-all', newPassword: 'brand-new-pw' },
        IP,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.changePassword(
        1,
        { currentPassword: 'old-password', newPassword: 'old-password' },
        IP,
      ),
    ).rejects.toThrow('different');
    const out = await service.changePassword(
      1,
      { currentPassword: 'old-password', newPassword: 'brand-new-pw' },
      IP,
    );
    expect(prisma.customer.update).toHaveBeenCalledTimes(1);
    expect(out.access_token).toEqual(expect.any(String));
  });

  it('a Google account sets a password with an emailed code', async () => {
    const { service, prisma, mail } = setup(
      customer({ authType: CustomerAuthType.GOOGLE }),
    );
    await expect(
      service.changePassword(1, { newPassword: 'brand-new-pw' }, IP),
    ).rejects.toThrow('code');
    await service.sendPasswordCode(1, IP);
    await service.changePassword(
      1,
      { code: sentCode(mail), newPassword: 'brand-new-pw' },
      IP,
    );
    expect(
      prisma.customer.update.mock.calls[0][0].data.passwordChangedAt,
    ).toBeInstanceOf(Date);
  });

  it('will not email a set-password code to an account that has a password', async () => {
    const { service, mail } = setup(customer({ passwordHash: 'x' }));
    await expect(service.sendPasswordCode(1, IP)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mail.send).not.toHaveBeenCalled();
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

  it('refuses a token issued before the password changed, accepts the new one', async () => {
    const { strategy, service, prisma, jwt } = setup(
      customer({ passwordHash: await hash('old-password', 4) }),
    );
    const old = { sub: 1, typ: 'customer' as const, email: 'a', name: 'b' };
    const before = Math.floor(Date.now() / 1000) - 60;
    const out = await service.changePassword(
      1,
      { currentPassword: 'old-password', newPassword: 'brand-new-pw' },
      IP,
    );
    const changed = customer(prisma.customer.update.mock.calls[0][0].data);
    prisma.customer.findUnique.mockResolvedValue(changed);
    await expect(
      strategy.validate({ ...old, iat: before }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      strategy.validate(jwt.verify(out.access_token)),
    ).resolves.toEqual({ customerId: 1 });
  });

  it("refuses a deleted customer's token", async () => {
    const { strategy } = setup(customer({ deletedAt: new Date() }));
    await expect(
      strategy.validate({ sub: 1, typ: 'customer', email: 'a', name: 'b' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('code-mail limits', () => {
  afterEach(() => jest.useRealTimers());

  it('a fresh signup for the same address within a minute is 429, not a second email', async () => {
    const { service, mail } = setup();
    await service.signup(SIGNUP, IP);
    await expect(service.signup(SIGNUP, '5.6.7.8')).rejects.toMatchObject({
      status: 429,
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('forgot password over the daily cap answers the same and sends nothing', async () => {
    jest.useFakeTimers();
    const { service, mail } = setup(customer());
    for (let i = 0; i < 5; i++) {
      await service.forgotPassword({ email: 'ana@example.com' }, '9.9.9.' + i);
      jest.advanceTimersByTime(SIGNUP_RESEND_MS);
    }
    expect(mail.send).toHaveBeenCalledTimes(5);
    await expect(
      service.forgotPassword({ email: 'ana@example.com' }, '9.9.9.9'),
    ).resolves.toEqual({ email: 'ana@example.com' });
    expect(mail.send).toHaveBeenCalledTimes(5);
  });

  it('a refused forgot keeps the code already mailed usable', async () => {
    jest.useFakeTimers();
    const { service, mail, prisma } = setup(customer());
    for (let i = 0; i < 5; i++) {
      await service.forgotPassword({ email: 'ana@example.com' }, '9.9.9.' + i);
      jest.advanceTimersByTime(SIGNUP_RESEND_MS);
    }
    const code = sentCode(mail);
    await service.forgotPassword({ email: 'ana@example.com' }, '9.9.9.9');
    await service.resetPassword(
      { email: 'ana@example.com', code, newPassword: 'brand-new-pw' },
      IP,
    );
    expect(prisma.customer.update).toHaveBeenCalledTimes(1);
  });

  it('stops every code email past the hourly cap (CODE_MAIL_MAX_PER_HOUR)', async () => {
    const { service, mail } = setup(null, { CODE_MAIL_MAX_PER_HOUR: '2' });
    await service.signup({ ...SIGNUP, email: 'a@x.com' }, '1.1.1.1');
    await service.signup({ ...SIGNUP, email: 'b@x.com' }, '1.1.1.2');
    await expect(
      service.signup({ ...SIGNUP, email: 'c@x.com' }, '1.1.1.3'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mail.send).toHaveBeenCalledTimes(2);
  });
});

describe('verifyHuman (Turnstile)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const reply = (body: object) =>
    fetchMock.mockResolvedValueOnce({ json: () => Promise.resolve(body) });

  it('is off while TURNSTILE_SECRET_KEY is unset', async () => {
    const { service } = setup();
    await expect(service.verifyHuman(undefined, IP)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a missing token without asking Cloudflare', async () => {
    const { service } = setup(null, { TURNSTILE_SECRET_KEY: 'sk' });
    await expect(service.verifyHuman(undefined, IP)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a token Cloudflare rejects, accepts one it passes', async () => {
    const { service } = setup(null, { TURNSTILE_SECRET_KEY: 'sk' });
    reply({ success: false, 'error-codes': ['invalid-input-response'] });
    await expect(service.verifyHuman('bad', IP)).rejects.toThrow('human');
    reply({ success: true });
    await expect(service.verifyHuman('good', IP)).resolves.toBeUndefined();
    const init = (fetchMock.mock.calls as [string, RequestInit][])[1][1];
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('sk');
    expect(body.get('response')).toBe('good');
    expect(body.get('remoteip')).toBe(IP);
  });

  it('lets the request through when Cloudflare cannot be reached', async () => {
    const { service } = setup(null, { TURNSTILE_SECRET_KEY: 'sk' });
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.verifyHuman('tok', IP)).resolves.toBeUndefined();
  });
});
