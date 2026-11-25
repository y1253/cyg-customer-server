import {
  Injectable,
  Optional,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionService } from '../billing/subscription.service';
import type { CustomerRequestUser } from './customer-jwt.strategy';
import { NO_SUBSCRIPTION_NEEDED } from './no-subscription-needed.decorator';

/**
 * Apply to any route that needs a signed-in customer. 2026-11-25: it also needs an active
 * plan (paid, free promo or free trial) — 402 `SUBSCRIPTION_REQUIRED` otherwise — unless
 * the route or its controller says `@NoSubscriptionNeeded()`.
 */
@Injectable()
export class CustomerJwtGuard extends AuthGuard('customer-jwt') {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly subscriptions?: SubscriptionService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok || !this.subscriptions) return ok;
    const open = this.reflector.getAllAndOverride<boolean>(
      NO_SUBSCRIPTION_NEEDED,
      [context.getHandler(), context.getClass()],
    );
    if (open) return true;
    const user = context
      .switchToHttp()
      .getRequest<{ user?: CustomerRequestUser }>().user;
    if (user) await this.subscriptions.assertActive(user.customerId);
    return true;
  }
}
