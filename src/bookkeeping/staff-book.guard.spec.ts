import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import { STAFF_BOOK_TOKEN_TYPE, StaffBookGuard } from './staff-book.guard';

const SECRET = 'test-customer-secret';
const jwt = new JwtService({ secret: SECRET });

function setup(
  company: { customerId: number | null } | null = { customerId: 7 },
) {
  const findFirst = jest.fn().mockResolvedValue(company);
  const prisma = { company: { findFirst } } as unknown as PrismaService;
  const config = {
    getOrThrow: () => SECRET,
  } as unknown as ConfigService;
  return { guard: new StaffBookGuard(config, prisma), findFirst };
}

function ctx(token: string, method = 'GET', companyId = '3') {
  const req: Record<string, unknown> = {
    method,
    params: { companyId },
    headers: { authorization: `Bearer ${token}` },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

const staffToken = (extra: Record<string, unknown> = {}) =>
  jwt.sign({
    typ: STAFF_BOOK_TOKEN_TYPE,
    sub: 11,
    companyId: 3,
    canEdit: false,
    ...extra,
  });

describe('StaffBookGuard', () => {
  it("scopes a staff token to the company's own book", async () => {
    const { guard } = setup();
    const { context, req } = ctx(staffToken());
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.staffBook).toEqual({
      scope: { customerId: 7, companyId: 3 },
      staffUserId: 11,
      canEdit: false,
    });
  });

  it("refuses a customer's login token", async () => {
    const { guard } = setup();
    const token = jwt.sign({ typ: 'customer', sub: 7 });
    await expect(guard.canActivate(ctx(token).context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a token signed with another secret', async () => {
    const { guard } = setup();
    const token = new JwtService({ secret: 'other' }).sign({
      typ: STAFF_BOOK_TOKEN_TYPE,
      sub: 11,
      companyId: 3,
    });
    await expect(guard.canActivate(ctx(token).context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a token for another company', async () => {
    const { guard } = setup();
    await expect(
      guard.canActivate(ctx(staffToken(), 'GET', '4').context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a write without canEdit, allows it with', async () => {
    const { guard } = setup();
    await expect(
      guard.canActivate(ctx(staffToken(), 'PUT').context),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(ctx(staffToken({ canEdit: true }), 'PUT').context),
    ).resolves.toBe(true);
  });

  it('is a 404 for a company with no customer book', async () => {
    const { guard } = setup(null);
    await expect(guard.canActivate(ctx(staffToken()).context)).rejects.toThrow(
      NotFoundException,
    );
  });
});
