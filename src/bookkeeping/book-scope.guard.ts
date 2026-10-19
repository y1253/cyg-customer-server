import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from './scope';

type ScopedRequest = Request & {
  user?: CustomerRequestUser;
  bookScope?: BookScope;
};

/**
 * Parses the optional `?companyId=` every bookkeeping route takes. Absent or blank = the
 * general book; anything else must be a positive integer.
 */
export function parseCompanyParam(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) {
    throw new BadRequestException('companyId must be a company id');
  }
  return Number(raw);
}

/**
 * Decides WHICH book a bookkeeping request acts on, and puts it on `req.bookScope`. Runs
 * after `CustomerJwtGuard` (class-level, so no route can forget it).
 *
 * A company must be the caller's own, submitted, not the firm's internal workspace and
 * not deleted — the same rule as the internal API's `CustomerPortalService.assertOwned`.
 * Anything else is a **404, never a 403**: "that business exists but is not yours" is
 * itself a disclosure.
 */
@Injectable()
export class BookScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ScopedRequest>();
    const customerId = req.user?.customerId;
    if (!customerId) return false; // CustomerJwtGuard runs first; belt and braces.
    req.bookScope = await this.resolve(customerId, req.query?.companyId);
    return true;
  }

  async resolve(customerId: number, raw: unknown): Promise<BookScope> {
    const companyId = parseCompanyParam(raw);
    if (companyId === null) return { customerId, companyId: null };
    const company = await this.prisma.company.findFirst({
      where: {
        id: companyId,
        customerId,
        isDraft: false,
        isInternal: false,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Business not found');
    return { customerId, companyId };
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
