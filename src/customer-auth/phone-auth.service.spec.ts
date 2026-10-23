import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CustomerMessenger } from '../messaging/customer-messenger.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CustomerAuthService } from './customer-auth.service';
import { PhoneAuthService } from './phone-auth.service';

const PHONE = '+15145550001';

function setup(accounts: Array<{ id: number; phoneE164: string }>) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    customer: {
      findMany: jest.fn(({ where }: { where: { phoneE164: string } }) =>
        Promise.resolve(
          accounts.filter((a) => a.phoneE164 === where.phoneE164),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: { phoneE164: string } }) =>
        Promise.resolve(
          accounts.find((a) => a.phoneE164 === where.phoneE164) ?? null,
        ),
      ),
      findUnique: jest.fn().mockResolvedValue({ homeCurrency: 'CAD' }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: 50, ...data });
      }),
    },
    book: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: { data: { customerId: number } }) =>
        Promise.resolve({ id: 1, companyId: null, ...data }),
      ),
    },
  };
  const texts: string[] = [];
  const messenger = {
    send: jest.fn(({ body }: { body: string }) => {
      texts.push(body);
      return Promise.resolve('sent');
    }),
  } as unknown as CustomerMessenger;
  const auth = {
    throttle: jest.fn(),
    note: jest.fn(),
    findActive: jest.fn((id: number) =>
      Promise.resolve(
        accounts.find((a) => a.id === id)
          ? { id, phoneE164: PHONE, deletedAt: null }
          : null,
      ),
    ),
    issueFor: jest.fn(() =>
      Promise.resolve({ access_token: 't', customer: {} }),
    ),
  } as unknown as CustomerAuthService & { issueFor: jest.Mock };
  const config = { get: () => undefined } as unknown as ConfigService;
  const service = new PhoneAuthService(
    prisma as unknown as PrismaService,
    config,
    auth,
    messenger,
  );
  return { service, texts, created, auth, prisma };
}

const codeIn = (text: string) => /^(\d{6}) /.exec(text)![1];

describe('PhoneAuthService (step12c)', () => {
  it('texts a code to the one account on the number, and the code signs in', async () => {
    const { service, texts, auth } = setup([{ id: 7, phoneE164: PHONE }]);
    await expect(service.requestCode('(514) 555-0001', 'ip')).resolves.toEqual({
      phone: PHONE,
    });
    expect(texts).toHaveLength(1);
    await expect(
      service.verifyCode(
        '514-555-0001',
        '000000' === codeIn(texts[0]) ? '111111' : '000000',
        'ip',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.verifyCode(PHONE, codeIn(texts[0]), 'ip');
    expect(auth.issueFor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
  });

  it('answers the same for a number with no account, and texts nothing', async () => {
    const { service, texts } = setup([]);
    await expect(service.requestCode(PHONE, 'ip')).resolves.toEqual({
      phone: PHONE,
    });
    expect(texts).toHaveLength(0);
  });

  it('texts nothing when two accounts share the number', async () => {
    const { service, texts } = setup([
      { id: 7, phoneE164: PHONE },
      { id: 8, phoneE164: PHONE },
    ]);
    await service.requestCode(PHONE, 'ip');
    expect(texts).toHaveLength(0);
  });

  it('opens an account on a phone with none, with its first book', async () => {
    const { service, created, prisma } = setup([]);
    await expect(service.signupByPhone(PHONE, 'CALL')).resolves.toEqual({
      customerId: 50,
      created: true,
    });
    expect(created[0]).toMatchObject({
      email: null,
      authType: 'PHONE',
      createdWith: 'CALL',
      phoneE164: PHONE,
      name: '',
    });
    expect(prisma.book.create).toHaveBeenCalledWith({
      data: { customerId: 50, name: 'Company1', homeCurrency: 'CAD' },
    });
  });

  it('opens nothing when the phone already has an account', async () => {
    const { service, created } = setup([{ id: 7, phoneE164: PHONE }]);
    await expect(service.signupByPhone(PHONE, 'SMS')).resolves.toEqual({
      customerId: 7,
      created: false,
    });
    expect(created).toHaveLength(0);
  });

  it('refuses something that is not a phone number', async () => {
    const { service } = setup([]);
    await expect(service.requestCode('12', 'ip')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
