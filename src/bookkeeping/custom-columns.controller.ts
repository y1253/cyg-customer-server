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
} from './dto/custom-column.dto';
import type { BookScope } from './scope';

/**
 * step8 (2026-11-11): `/api/bookkeeping/custom-columns` — the customer's own ledger columns
 * for one book, and `PUT transactions/:id/custom/:columnId` — one cell. Every write answers
 * the whole view, so the ledger refreshes from it.
 */
@Controller('bookkeeping')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class CustomColumnsController {
  constructor(private readonly columns: CustomColumnsService) {}

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
    return this.columns.view(scope);
  }
}
