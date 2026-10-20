import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The claim on the INTERNAL API's token when it forwards a customer's text / WhatsApp to
 * the assistant (step11). Signed with `CUSTOMER_JWT_SECRET` like `staff-book`, and
 * deliberately neither `'customer'` (so it is never a login) nor `'staff-book'`.
 */
export const INTAKE_AGENT_TOKEN_TYPE = 'intake-agent';

type IntakeRequest = Request & { intakeCustomerId?: number };

/**
 * Lets the internal API act for ONE customer — the one whose phone matched the text. The
 * token names the customer (`sub`); a closed account is refused.
 */
@Injectable()
export class IntakeAgentGuard implements CanActivate {
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
    const req = ctx.switchToHttp().getRequest<IntakeRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    let p: { typ?: unknown; sub?: unknown };
    try {
      p = this.jwt.verify<{ typ?: unknown; sub?: unknown }>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (p.typ !== INTAKE_AGENT_TOKEN_TYPE || typeof p.sub !== 'number') {
      throw new UnauthorizedException();
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: p.sub, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new UnauthorizedException();
    req.intakeCustomerId = customer.id;
    return true;
  }
}

/** The customer `IntakeAgentGuard` resolved for this request. */
export const IntakeCustomer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): number => {
    const id = ctx.switchToHttp().getRequest<IntakeRequest>().intakeCustomerId;
    if (!id) throw new Error('IntakeAgentGuard did not run on this route');
    return id;
  },
);
