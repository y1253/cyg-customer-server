import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { NoSubscriptionNeeded } from '../customer-auth/no-subscription-needed.decorator';
import { RedeemDto } from './dto/billing.dto';
import {
  StripeBillingService,
  type PlanPrice,
  type SubscriptionView,
} from './stripe-billing.service';

type AuthedRequest = Request & { user: CustomerRequestUser };

/**
 * `/api/billing` — the monthly subscription (2026-11-25). Open to a LOCKED customer (it is
 * how they unlock); every route acts only on the signed-in customer.
 */
@Controller('billing')
@UseGuards(CustomerJwtGuard)
@NoSubscriptionNeeded()
export class BillingController {
  constructor(private readonly billing: StripeBillingService) {}

  @Get('config')
  async config(): Promise<{ price: PlanPrice | null }> {
    return { price: await this.billing.price() };
  }

  @Get('subscription')
  subscription(@Req() req: AuthedRequest): Promise<SubscriptionView> {
    return this.billing.view(req.user.customerId);
  }

  /** A Stripe Checkout page for the plan; the client redirects to `url`. */
  @Post('subscribe')
  @HttpCode(200)
  subscribe(@Req() req: AuthedRequest): Promise<{ url: string }> {
    return this.billing.startCheckout(req.user.customerId);
  }

  /** The Stripe Billing Portal (card, cancel, invoices). */
  @Post('portal')
  @HttpCode(200)
  portal(@Req() req: AuthedRequest): Promise<{ url: string }> {
    return this.billing.portal(req.user.customerId);
  }

  @Post('redeem')
  @HttpCode(200)
  redeem(
    @Req() req: AuthedRequest,
    @Body() dto: RedeemDto,
  ): Promise<{ freeUntil: string | null; freeForever: boolean }> {
    return this.billing.redeemPromo(req.user.customerId, dto.promoCode);
  }
}

/**
 * `POST /api/billing/webhook` — Stripe calls it, so no customer guard; the signature
 * (`STRIPE_WEBHOOK_SECRET`) over the RAW body is the authentication. 404 when unset.
 */
@Controller('billing')
export class BillingWebhookController {
  constructor(private readonly billing: StripeBillingService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature)
      throw new BadRequestException('Missing signature');
    await this.billing.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
