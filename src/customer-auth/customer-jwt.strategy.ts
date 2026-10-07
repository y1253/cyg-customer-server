import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  CUSTOMER_TOKEN_TYPE,
  CustomerAuthService,
  type CustomerJwtPayload,
} from './customer-auth.service';

/** What a guarded route sees on `req.user`. */
export interface CustomerRequestUser {
  customerId: number;
}

/**
 * Verifies a customer token. Two independent locks keep staff tokens out: the secret is
 * `CUSTOMER_JWT_SECRET`, never the internal app's `JWT_SECRET`, AND the payload must carry
 * `typ: 'customer'`. The customer is re-loaded on every request, so a closed account stops
 * working immediately even though sessions are stateless.
 */
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(
  Strategy,
  'customer-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly auth: CustomerAuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  async validate(
    payload: Partial<CustomerJwtPayload>,
  ): Promise<CustomerRequestUser> {
    if (
      payload.typ !== CUSTOMER_TOKEN_TYPE ||
      typeof payload.sub !== 'number'
    ) {
      throw new UnauthorizedException();
    }
    const customer = await this.auth.findActive(payload.sub);
    if (!customer) throw new UnauthorizedException();
    return { customerId: customer.id };
  }
}
