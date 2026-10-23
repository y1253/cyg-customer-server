import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { bookScope, type BookScope } from './scope';

/** The name of the book every customer starts with (step12c). */
export const FIRST_BOOK_NAME = 'Company1';

export interface BookView {
  id: number;
  name: string;
  homeCurrency: string;
}

const LIVE = { deletedAt: null } as const;

/**
 * The customer's bookkeeping companies — the Bookkeeping switcher. A registered business's
 * own book (`companyId` set) is not one of them. Creates "Company1" when there is none, so
 * every customer always has a book to land in.
 */
export async function listBooks(
  prisma: PrismaService,
  customerId: number,
): Promise<BookView[]> {
  await ensureDefaultBook(prisma, customerId);
  return prisma.book.findMany({
    where: { customerId, companyId: null, ...LIVE },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, homeCurrency: true },
  });
}

/**
 * The customer's default book: their first bookkeeping company, created as "Company1" if
 * they have none (a new account, or one opened by phone). Texted receipts, schedules and
 * every caller without a book choice land here.
 */
export async function ensureDefaultBook(
  prisma: PrismaService,
  customerId: number,
): Promise<BookScope> {
  const found = await prisma.book.findFirst({
    where: { customerId, companyId: null, ...LIVE },
    orderBy: { id: 'asc' },
  });
  if (found) return bookScope(found);
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { homeCurrency: true },
  });
  const created = await prisma.book.create({
    data: {
      customerId,
      name: FIRST_BOOK_NAME,
      homeCurrency: customer?.homeCurrency ?? 'CAD',
    },
  });
  return bookScope(created);
}

/** One of the customer's books (a bookkeeping company or a business's), else 404. */
export async function ownBook(
  prisma: PrismaService,
  customerId: number,
  bookId: number,
): Promise<BookScope> {
  const book = await prisma.book.findFirst({
    where: { id: bookId, customerId, ...LIVE },
  });
  if (!book) throw new NotFoundException('Company not found');
  if (
    book.companyId !== null &&
    !(await liveCompany(prisma, customerId, book.companyId))
  ) {
    throw new NotFoundException('Company not found');
  }
  return bookScope(book);
}

/**
 * A registered business's book, created on first use. The business must be the caller's
 * own, submitted, not the firm's internal workspace and not deleted — else 404.
 */
export async function businessBook(
  prisma: PrismaService,
  customerId: number,
  companyId: number,
): Promise<BookScope> {
  const company = await liveCompany(prisma, customerId, companyId);
  if (!company) throw new NotFoundException('Business not found');
  return companyBook(prisma, company.id);
}

/**
 * The book of a company, whoever asks (staff, intake) — created on first use under the
 * company's owner. Null when the company has no owning customer.
 */
export async function companyBook(
  prisma: PrismaService,
  companyId: number,
): Promise<BookScope> {
  const found = await prisma.book.findUnique({ where: { companyId } });
  if (found) return bookScope(found);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { customerId: true, businessName: true, bookHomeCurrency: true },
  });
  if (!company?.customerId) throw new NotFoundException('Business not found');
  const created = await prisma.book.create({
    data: {
      customerId: company.customerId,
      companyId,
      name: company.businessName.slice(0, 120),
      homeCurrency: company.bookHomeCurrency,
    },
  });
  return bookScope(created);
}

/**
 * Turns a book reference carried from before step12c (a `companyId`, or null = "the general
 * book") or after it (a `bookId`) into a scope — for signed tokens and Stripe metadata still
 * in flight across the deploy.
 */
export async function legacyBook(
  prisma: PrismaService,
  customerId: number,
  ref: { bookId?: number | null; companyId?: number | null },
): Promise<BookScope> {
  if (ref.bookId) return ownBook(prisma, customerId, ref.bookId);
  if (ref.companyId) return businessBook(prisma, customerId, ref.companyId);
  return ensureDefaultBook(prisma, customerId);
}

function liveCompany(
  prisma: PrismaService,
  customerId: number,
  companyId: number,
) {
  return prisma.company.findFirst({
    where: {
      id: companyId,
      customerId,
      isDraft: false,
      isInternal: false,
      deletedAt: null,
    },
    select: { id: true },
  });
}

/** Whose name heads an export or a report: the book's (the company's) name. */
export async function bookOwnerName(
  prisma: PrismaService,
  scope: BookScope,
): Promise<string> {
  const book = await prisma.book.findUnique({
    where: { id: scope.bookId },
    select: { name: true },
  });
  return book?.name ?? 'Your books';
}

/** step12c: a new bookkeeping company, in the customer's default currency. */
export async function createBook(
  prisma: PrismaService,
  customerId: number,
  name: string,
): Promise<BookView> {
  const clean = bookName(name);
  const first = await ensureDefaultBook(prisma, customerId);
  const home = await prisma.book.findUnique({
    where: { id: first.bookId },
    select: { homeCurrency: true },
  });
  return prisma.book.create({
    data: {
      customerId,
      name: clean,
      homeCurrency: home?.homeCurrency ?? 'CAD',
    },
    select: { id: true, name: true, homeCurrency: true },
  });
}

/** step12c: renames one of the customer's bookkeeping companies. */
export async function renameBook(
  prisma: PrismaService,
  customerId: number,
  bookId: number,
  name: string,
): Promise<BookView> {
  const clean = bookName(name);
  const book = await prisma.book.findFirst({
    where: { id: bookId, customerId, companyId: null, ...LIVE },
    select: { id: true },
  });
  if (!book) throw new NotFoundException('Company not found');
  return prisma.book.update({
    where: { id: book.id },
    data: { name: clean },
    select: { id: true, name: true, homeCurrency: true },
  });
}

function bookName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new BadRequestException('Give the company a name');
  return name;
}
