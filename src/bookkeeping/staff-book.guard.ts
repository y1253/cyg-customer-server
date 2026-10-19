import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from './scope';

/**
 * The claim on a STAFF token: the internal API acting on one company's book for a staff
 * member (step2, the internal "Rules" tab). Signed with `CUSTOMER_JWT_SECRET` — the trust
 * both servers already share — and deliberately NOT `'customer'`, so `CustomerJwtStrategy`
 * refuses it as a login and `StaffBookGuard` refuses a customer's token.
 */
export const STAFF_BOOK_TOKEN_TYPE = 'staff-book';

export interface StaffBookPayload {
  typ: string;
  /** The staff user (internal `User.id`), for the log. */
  sub: number;
  companyId: number;
  /** ADMIN / MANAGER — decided by the internal API, which owns staff roles. */
  canEdit: boolean;
}

export interface StaffBook {
  scope: BookScope;
  staffUserId: number;
  canEdit: boolean;
}

type StaffRequest = Request & { staffBook?: StaffBook };

/**
 * Lets the internal API into ONE company's book: a short-lived staff token for exactly the
 * `:companyId` in the path. Only a company's own book is ever reachable — never a
 * customer's general one. Writes (anything but GET) also need `canEdit`.
 */
@Injectable()
export class StaffBookGuard implements CanActivate {
  private readonly jwt: JwtService;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<StaffRequest>();
    const payload = this.verify(req.headers.authorization);
    const companyId = Number(req.params?.companyId);
    if (payload.companyId !== companyId) throw new UnauthorizedException();
    if (req.method !== 'GET' && !payload.canEdit) {
      throw new ForbiddenException('Only a manager can change these rules');
    }
    req.staffBook = {
      scope: await this.scopeOf(companyId),
      staffUserId: payload.sub,
      canEdit: payload.canEdit,
    };
    return true;
  }

  private verify(header: string | undefined): StaffBookPayload {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    let p: Partial<StaffBookPayload>;
    try {
      p = this.jwt.verify<StaffBookPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (
      p.typ !== STAFF_BOOK_TOKEN_TYPE ||
      typeof p.sub !== 'number' ||
      typeof p.companyId !== 'number'
    ) {
      throw new UnauthorizedException();
    }
    return { ...p, canEdit: p.canEdit === true } as StaffBookPayload;
  }

  /** The company's own book; 404 for a draft, deleted, internal or customer-less one. */
  async scopeOf(companyId: number): Promise<BookScope> {
    const company = await this.prisma.company.findFirst({
      where: {
        id: companyId,
        customerId: { not: null },
        isDraft: false,
        isInternal: false,
        deletedAt: null,
      },
      select: { customerId: true },
    });
    if (!company?.customerId) throw new NotFoundException('Business not found');
    return { customerId: company.customerId, companyId };
  }
}

/** The book and staff member `StaffBookGuard` resolved for this request. */
export const Staff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffBook => {
    const staff = ctx.switchToHttp().getRequest<StaffRequest>().staffBook;
    if (!staff) throw new Error('StaffBookGuard did not run on this route');
    return staff;
  },
);
