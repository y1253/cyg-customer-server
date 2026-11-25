import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionService } from '../billing/subscription.service';
declare const CustomerJwtGuard_base: import("@nestjs/passport").Type<import("@nestjs/passport").IAuthGuard>;
export declare class CustomerJwtGuard extends CustomerJwtGuard_base {
    private readonly reflector;
    private readonly subscriptions?;
    constructor(reflector: Reflector, subscriptions?: SubscriptionService | undefined);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export {};
