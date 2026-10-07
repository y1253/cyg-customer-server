import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CustomerAuthType, type Customer } from '@prisma/client';
import { hash } from 'bcryptjs';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AUTH_LIMIT,
  CustomerAuthService,
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
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    lastLoginAt: null,
    deletedAt: null,
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
  const service = new CustomerAuthService(
    prisma as unknown as PrismaService,
    jwt,
    config,
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
  return { service, prisma, jwt, google, strategy };
}

describe('signup', () => {
  it('creates a PASSWORD account with a hashed password and a customer token', async () => {
    const { service, prisma, jwt } = setup();
    const out = await service.signup(
      { name: 'Ana', email: 'Ana@Example.com', password: 'longenough' },
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
  });

  it('refuses an email that already has an account with 409', async () => {
    const { service } = setup(customer());
    await expect(
      service.signup(
        { name: 'Ana', email: 'ana@example.com', password: 'longenough' },
        IP,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
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
