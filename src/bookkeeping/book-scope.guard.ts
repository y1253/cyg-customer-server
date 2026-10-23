import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { businessBook, ensureDefaultBook, ownBook } from './books';
import type { BookScope } from './scope';

type ScopedRequest = Request & {
  user?: CustomerRequestUser;
  bookScope?: BookScope;
};

/**
 * Parses an optional positive id query param (`?bookId=`, `?companyId=`). Absent or blank =
 * null; anything else must be a positive integer.
 */
export function parseIdParam(raw: unknown, name = 'id'): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) {
    throw new BadRequestException(`${name} must be an id`);
  }
  return Number(raw);
}

/**
 * Decides WHICH book a bookkeeping request acts on, and puts it on `req.bookScope`. Runs
 * after `CustomerJwtGuard` (class-level, so no route can forget it).
 *
 * step12c: `?bookId=` = one of the caller's books (a bookkeeping company); `?companyId=` =
 * a registered business's own book (the hidden "My businesses" portal still sends it);
 * neither = the caller's default book ("Company1"). A book or business that is not the
 * caller's is a **404, never a 403**: "that exists but is not yours" is itself a disclosure.
 */
@Injectable()
export class BookScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ScopedRequest>();
    const customerId = req.user?.customerId;
    if (!customerId) return false; // CustomerJwtGuard runs first; belt and braces.
    req.bookScope = await this.resolve(customerId, req.query ?? {});
    return true;
  }

  async resolve(
    customerId: number,
    query: { bookId?: unknown; companyId?: unknown },
  ): Promise<BookScope> {
    const bookId = parseIdParam(query.bookId, 'bookId');
    if (bookId !== null) return ownBook(this.prisma, customerId, bookId);
    const companyId = parseIdParam(query.companyId, 'companyId');
    if (companyId !== null)
      return businessBook(this.prisma, customerId, companyId);
    return ensureDefaultBook(this.prisma, customerId);
  }
}

/** The book `BookScopeGuard` resolved for this request. */
export const Book = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): BookScope => {
    const scope = ctx.switchToHttp().getRequest<ScopedRequest>().bookScope;
    if (!scope) throw new Error('BookScopeGuard did not run on this route');
    return scope;
  },
);
