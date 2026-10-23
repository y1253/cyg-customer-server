import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { BookScopeGuard, parseIdParam } from './book-scope.guard';

describe('parseIdParam', () => {
  it('reads an absent or blank value as none', () => {
    expect(parseIdParam(undefined)).toBeNull();
    expect(parseIdParam('')).toBeNull();
  });

  it('accepts a positive integer', () => {
    expect(parseIdParam('42')).toBe(42);
  });

  it.each(['0', '-1', '1.5', 'abc', '01', ['1', '2']])('refuses %p', (raw) => {
    expect(() => parseIdParam(raw)).toThrow(BadRequestException);
  });
});

describe('BookScopeGuard.resolve (step12c: books)', () => {
  type BookRow = { id: number; customerId: number; companyId: number | null };
  function guardWith(opts: {
    books?: BookRow[];
    company?: { id: number } | null;
  }) {
    const books = opts.books ?? [];
    const book = {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { id?: number; customerId: number; companyId?: null };
        }) =>
          Promise.resolve(
            books.find(
              (b) =>
                b.customerId === where.customerId &&
                (where.id === undefined || b.id === where.id) &&
                (where.companyId === undefined ||
                  b.companyId === where.companyId),
            ) ?? null,
          ),
      ),
      findUnique: jest.fn(({ where }: { where: { companyId: number } }) =>
        Promise.resolve(
          books.find((b) => b.companyId === where.companyId) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: Omit<BookRow, 'id'> }) =>
        Promise.resolve({ id: 99, companyId: null, ...data }),
      ),
    };
    const company = {
      findFirst: jest.fn().mockResolvedValue(opts.company ?? null),
      findUnique: jest.fn().mockResolvedValue(null),
    };
    const customer = {
      findUnique: jest.fn().mockResolvedValue({ homeCurrency: 'CAD' }),
    };
    const prisma = { book, company, customer } as unknown as PrismaService;
    return { guard: new BookScopeGuard(prisma), book, company };
  }

  it("is the customer's default book without a param", async () => {
    const { guard } = guardWith({
      books: [{ id: 5, customerId: 7, companyId: null }],
    });
    await expect(guard.resolve(7, {})).resolves.toEqual({
      customerId: 7,
      bookId: 5,
      companyId: null,
    });
  });

  it('creates "Company1" for a customer with no book yet', async () => {
    const { guard, book } = guardWith({});
    await expect(guard.resolve(7, {})).resolves.toEqual({
      customerId: 7,
      bookId: 99,
      companyId: null,
    });
    expect(book.create).toHaveBeenCalledWith({
      data: { customerId: 7, name: 'Company1', homeCurrency: 'CAD' },
    });
  });

  it("scopes to the caller's own book by ?bookId=", async () => {
    const { guard } = guardWith({
      books: [
        { id: 5, customerId: 7, companyId: null },
        { id: 6, customerId: 7, companyId: null },
      ],
    });
    await expect(guard.resolve(7, { bookId: '6' })).resolves.toEqual({
      customerId: 7,
      bookId: 6,
      companyId: null,
    });
  });

  it("is a 404 for somebody else's book", async () => {
    const { guard } = guardWith({
      books: [{ id: 8, customerId: 2, companyId: null }],
    });
    await expect(guard.resolve(7, { bookId: '8' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("maps ?companyId= to that business's own book", async () => {
    const { guard, company } = guardWith({
      books: [{ id: 12, customerId: 7, companyId: 3 }],
      company: { id: 3 },
    });
    await expect(guard.resolve(7, { companyId: '3' })).resolves.toEqual({
      customerId: 7,
      bookId: 12,
      companyId: 3,
    });
    expect(company.findFirst).toHaveBeenCalledWith({
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
    const { guard } = guardWith({ company: null });
    await expect(guard.resolve(7, { companyId: '99' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
