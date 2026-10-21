import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Book, BookScopeGuard } from '../bookkeeping/book-scope.guard';
import type { BookScope } from '../bookkeeping/scope';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import {
  BankFeedsService,
  type BankConnectionView,
} from './bank-feeds.service';
import { ExchangeDto } from './dto/bank-feeds.dto';

/**
 * `/api/bank-feeds/*` — a customer's bank connections (step11), per BOOK like every
 * bookkeeping route (`?companyId=`; absent = the general book).
 */
@Controller('bank-feeds')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class BankFeedsController {
  constructor(private readonly feeds: BankFeedsService) {}

  /** Whether "Connect your bank" is offered at all (keys set on the server). */
  @Get('config')
  config(): { enabled: boolean } {
    return { enabled: this.feeds.enabled };
  }

  @Get()
  list(@Book() scope: BookScope): Promise<BankConnectionView[]> {
    return this.feeds.list(scope);
  }

  /** `?itemId=` = update mode: sign in to that bank again. */
  @Post('link-token')
  linkToken(
    @Book() scope: BookScope,
    @Query('itemId') itemId?: string,
  ): Promise<{ linkToken: string }> {
    if (itemId !== undefined && !/^[1-9]\d{0,9}$/.test(itemId)) {
      throw new BadRequestException('Invalid connection');
    }
    return this.feeds.linkToken(scope, itemId ? Number(itemId) : undefined);
  }

  @Post('exchange')
  exchange(
    @Book() scope: BookScope,
    @Body() dto: ExchangeDto,
  ): Promise<BankConnectionView> {
    return this.feeds.exchange(scope, dto.publicToken);
  }

  @Post(':id/reconnected')
  reconnected(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BankConnectionView> {
    return this.feeds.reconnected(scope, id);
  }

  @Post(':id/sync')
  refresh(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BankConnectionView> {
    return this.feeds.refresh(scope, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.feeds.remove(scope, id);
  }
}

/**
 * `POST /api/plaid/webhook` — Plaid calls it, so no customer guard; the
 * `Plaid-Verification` JWT over the RAW body is the authentication. 404 while Plaid is not
 * set up.
 */
@Controller('plaid')
export class PlaidWebhookController {
  private readonly logger = new Logger(PlaidWebhookController.name);

  constructor(private readonly feeds: BankFeedsService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('plaid-verification') token: string | undefined,
  ): Promise<{ received: true }> {
    if (!this.feeds.enabled) throw new NotFoundException();
    const problem = await this.feeds.verify(token, req.rawBody);
    if (problem) {
      this.logger.warn(`rejected a Plaid webhook: ${problem}`);
      throw new BadRequestException('Invalid signature');
    }
    let body: Parameters<BankFeedsService['handle']>[0];
    try {
      body = JSON.parse(req.rawBody!.toString('utf8')) as typeof body;
    } catch {
      throw new BadRequestException('Invalid body');
    }
    void this.feeds
      .handle(body)
      .catch((err) =>
        this.logger.warn(`Plaid webhook handling failed: ${String(err)}`),
      );
    return { received: true };
  }
}
