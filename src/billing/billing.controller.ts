import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Book, BookScopeGuard } from '../bookkeeping/book-scope.guard';
import type { BookScope } from '../bookkeeping/scope';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import {
  BillingService,
  type BillingConfigView,
  type CheckoutView,
  type QuoteView,
  type SavedCardView,
} from './billing.service';
import { CheckoutDto, CompleteDto, QuoteDto } from './dto/billing.dto';

type AuthedRequest = Request & { user: CustomerRequestUser };

/** `/api/billing` — pay per Generate. Every route acts only on the signed-in customer. */
@Controller('billing')
@UseGuards(CustomerJwtGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('config')
  config(): Promise<BillingConfigView> {
    return this.billing.config();
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: QuoteDto): Promise<QuoteView> {
    return this.billing.quote(dto.promoCode);
  }

  @Get('cards')
  cards(@Req() req: AuthedRequest): Promise<SavedCardView[]> {
    return this.billing.cards(req.user.customerId);
  }

  @Delete('cards/:id')
  @HttpCode(204)
  async removeCard(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    if (!/^pm_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid card');
    await this.billing.removeCard(req.user.customerId, id);
  }

  /** Pays for (and runs) a Generate of one book — `?companyId=` as on `/bookkeeping`. */
  @Post('checkout')
  @HttpCode(200)
  @UseGuards(BookScopeGuard)
  checkout(
    @Book() scope: BookScope,
    @Body() dto: CheckoutDto,
  ): Promise<CheckoutView> {
    return this.billing.checkout(scope, dto.promoCode, dto.paymentMethodId);
  }

  @Post('complete')
  @HttpCode(200)
  @UseGuards(BookScopeGuard)
  complete(
    @Book() scope: BookScope,
    @Body() dto: CompleteDto,
  ): Promise<{ queued: number; taxing: boolean }> {
    return this.billing.complete(scope, dto.paymentIntentId);
  }
}

/**
 * `POST /api/billing/webhook` — Stripe calls it, so no customer guard; the signature
 * (`STRIPE_WEBHOOK_SECRET`) over the RAW body is the authentication. 404 when unset.
 */
@Controller('billing')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

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
