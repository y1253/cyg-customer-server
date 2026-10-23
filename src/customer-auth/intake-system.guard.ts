import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

/**
 * step12c: the claim on the INTERNAL API's token when it acts for a phone that is NOT a
 * customer yet — opening an account after the texted offer, or passing on a reply from
 * someone the AI called or texted for a customer. Signed with `CUSTOMER_JWT_SECRET`, and
 * deliberately none of `'customer'`, `'staff-book'` or `'intake-agent'`. No `sub`.
 */
export const INTAKE_SYSTEM_TOKEN_TYPE = 'intake-system';

@Injectable()
export class IntakeSystemGuard implements CanActivate {
  private readonly jwt: JwtService;

  constructor(config: ConfigService) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    let p: { typ?: unknown };
    try {
      p = this.jwt.verify<{ typ?: unknown }>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (p.typ !== INTAKE_SYSTEM_TOKEN_TYPE) throw new UnauthorizedException();
    return true;
  }
}
