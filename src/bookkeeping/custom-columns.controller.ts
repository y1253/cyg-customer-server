import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import { Book, BookScopeGuard } from './book-scope.guard';
import {
  CustomColumnsService,
  type CustomColumnsView,
} from './custom-columns.service';
import {
  CopyCustomColumnsDto,
  CustomAnswerDto,
  CustomColumnDto,
  CustomColumnOrderDto,
  CustomNameAnswerDto,
} from './dto/custom-column.dto';
import type { BookScope } from './scope';
import { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';

/**
 * step8 (2026-11-11): `/api/bookkeeping/custom-columns` — the customer's own ledger columns
 * for one book, and `PUT transactions/:id/custom/:columnId` — one cell. Every write answers
 * the whole view, so the ledger refreshes from it.
 */
@Controller('bookkeeping')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class CustomColumnsController {
  constructor(
    private readonly columns: CustomColumnsService,
    private readonly qbo: QuickBooksSyncService,
  ) {}

  @Get('custom-columns')
  view(@Book() scope: BookScope): Promise<CustomColumnsView> {
    return this.columns.view(scope);
  }

  @Post('custom-columns')
  async create(
    @Book() scope: BookScope,
    @Body() dto: CustomColumnDto,
  ): Promise<CustomColumnsView> {
    await this.columns.create(scope, dto);
    return this.columns.view(scope);
  }

  @Post('custom-columns/copy')
  async copy(
    @Book() scope: BookScope,
    @Body() dto: CopyCustomColumnsDto,
  ): Promise<CustomColumnsView> {
    await this.columns.copy(scope, dto.fromBookId);
    return this.columns.view(scope);
  }

  @Put('custom-columns/order')
  async reorder(
    @Book() scope: BookScope,
    @Body() dto: CustomColumnOrderDto,
  ): Promise<CustomColumnsView> {
    await this.columns.reorder(scope, dto.ids);
    return this.columns.view(scope);
  }

  @Patch('custom-columns/:id')
  async update(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CustomColumnDto,
  ): Promise<CustomColumnsView> {
    await this.columns.update(scope, id, dto);
    return this.columns.view(scope);
  }

  @Delete('custom-columns/:id')
  async remove(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomColumnsView> {
    await this.columns.remove(scope, id);
    return this.columns.view(scope);
  }

  @Put('transactions/:id/custom/:columnId')
  async answer(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Param('columnId', ParseIntPipe) columnId: number,
    @Body() dto: CustomAnswerDto,
  ): Promise<CustomColumnsView> {
    await this.columns.answer(scope, [id], columnId, dto);
    // step11 part 4: a QuickBooks-linked answer reaches QuickBooks now, not at the next sweep.
    this.qbo.syncSoon(scope.bookId);
    return this.columns.view(scope);
  }

  /** step9 (2026-11-19): a name's / sub-name's default answer — fills its empty cells. */
  @Put('custom-columns/:id/names')
  async nameAnswer(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CustomNameAnswerDto,
  ): Promise<CustomColumnsView> {
    const { name, subNameId, ...answer } = dto;
    await this.columns.setNameAnswer(scope, id, { name, subNameId }, answer);
    return this.columns.view(scope);
  }
}
