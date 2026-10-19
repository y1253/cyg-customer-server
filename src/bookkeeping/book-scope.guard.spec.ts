import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { BookScopeGuard, parseCompanyParam } from './book-scope.guard';

describe('parseCompanyParam', () => {
  it('reads an absent or blank value as the general book', () => {
    expect(parseCompanyParam(undefined)).toBeNull();
    expect(parseCompanyParam('')).toBeNull();
  });

  it('accepts a positive integer', () => {
    expect(parseCompanyParam('42')).toBe(42);
  });

  it.each(['0', '-1', '1.5', 'abc', '01', ['1', '2']])('refuses %p', (raw) => {
    expect(() => parseCompanyParam(raw)).toThrow(BadRequestException);
  });
});

describe('BookScopeGuard.resolve', () => {
  function guardWith(company: { id: number } | null) {
    const findFirst = jest.fn().mockResolvedValue(company);
    const prisma = { company: { findFirst } } as unknown as PrismaService;
    return { guard: new BookScopeGuard(prisma), findFirst };
  }

  it('is the general book without a companyId, and asks nothing', async () => {
    const { guard, findFirst } = guardWith(null);
    await expect(guard.resolve(7, undefined)).resolves.toEqual({
      customerId: 7,
      companyId: null,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("scopes to the caller's own submitted company", async () => {
    const { guard, findFirst } = guardWith({ id: 3 });
    await expect(guard.resolve(7, '3')).resolves.toEqual({
      customerId: 7,
      companyId: 3,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 3,
        customerId: 7,
        isDraft: false,
        isInternal: false,
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it("is a 404 for somebody else's company, a draft or a deleted one", async () => {
    const { guard } = guardWith(null);
    await expect(guard.resolve(7, '99')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
