import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { createBook, listBooks, renameBook, type BookView } from './books';
import { BookNameDto } from './dto/book.dto';

type AuthedRequest = Request & { user: CustomerRequestUser };

/**
 * step12c: `/api/bookkeeping/books` — the customer's bookkeeping companies (the switcher on
 * the Bookkeeping page). The first, "Company1", is created on first look. A registered
 * business's own book is not listed.
 */
@Controller('bookkeeping/books')
@UseGuards(CustomerJwtGuard)
export class BooksController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<BookView[]> {
    return listBooks(this.prisma, req.user.customerId);
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() dto: BookNameDto,
  ): Promise<BookView> {
    return createBook(this.prisma, req.user.customerId, dto.name);
  }

  @Patch(':id')
  rename(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BookNameDto,
  ): Promise<BookView> {
    return renameBook(this.prisma, req.user.customerId, id, dto.name);
  }
}
