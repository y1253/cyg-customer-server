import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { bookLabel } from '../bookkeeping/scope';
import {
  Staff,
  StaffBookGuard,
  type StaffBook,
} from '../bookkeeping/staff-book.guard';
import {
  BankFeedsService,
  type BankConnectionView,
} from './bank-feeds.service';
import { ExchangeDto, StartDatesDto } from './dto/bank-feeds.dto';

/**
 * `/api/staff/books/:companyId/bank-feeds` — step11 (internal, 2026-11-23): the internal
 * app's Bank feeds card for one company, on that company's OWN book. The same connections a
 * customer makes on the site (one Plaid setup, one book), so either side sees the other's.
 * Called ONLY by the internal API with a `staff-book` token (`StaffBookGuard`); writes need
 * `canEdit`, which the internal API gives ADMINs only for these routes.
 */
@Controller('staff/books/:companyId/bank-feeds')
@UseGuards(StaffBookGuard)
export class StaffBankFeedsController {
  private readonly logger = new Logger(StaffBankFeedsController.name);

  constructor(private readonly feeds: BankFeedsService) {}

  @Get('config')
  config(): { enabled: boolean } {
    return { enabled: this.feeds.enabled };
  }

  @Get()
  list(@Staff() staff: StaffBook): Promise<BankConnectionView[]> {
    return this.feeds.list(staff.scope);
  }

  @Post('link-token')
  linkToken(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Query('itemId') itemId?: string,
    @Query('accounts') accounts?: string,
  ): Promise<{ linkToken: string }> {
    if (itemId !== undefined && !/^[1-9]\d{0,9}$/.test(itemId)) {
      throw new BadRequestException('Invalid connection');
    }
    return this.feeds.linkToken(
      staff.scope,
      itemId ? Number(itemId) : undefined,
      accounts === '1',
      true,
    );
  }

  @Post('exchange')
  async exchange(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: ExchangeDto,
  ): Promise<BankConnectionView> {
    const view = await this.feeds.exchange(staff.scope, dto.publicToken);
    this.log(staff, `connected ${view.institutionName ?? 'a bank'} (#${view.id})`);
    return view;
  }

  @Post(':id/reconnected')
  reconnected(
    @Staff() staff: StaffBook,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BankConnectionView> {
    return this.feeds.reconnected(staff.scope, id);
  }

  @Put(':id/accounts')
  setStartDates(
    @Staff() staff: StaffBook,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartDatesDto,
  ): Promise<BankConnectionView> {
    return this.feeds.setStartDates(staff.scope, id, dto.accounts);
  }

  @Post(':id/sync')
  refresh(
    @Staff() staff: StaffBook,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BankConnectionView> {
    return this.feeds.refresh(staff.scope, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Staff() staff: StaffBook,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.feeds.remove(staff.scope, id);
    this.log(staff, `disconnected bank #${id}`);
  }

  private log(staff: StaffBook, what: string): void {
    this.logger.log(
      `staff user #${staff.staffUserId} ${what} for ${bookLabel(staff.scope)}`,
    );
  }
}
