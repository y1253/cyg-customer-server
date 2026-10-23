import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { AiContactsService, type ContactView } from './ai-contacts.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

type AuthedRequest = Request & { user: CustomerRequestUser };

/** step12c: `/api/contacts` — the Contacts tab (people the AI calls / texts for the customer). */
@Controller('contacts')
@UseGuards(CustomerJwtGuard)
export class AiContactsController {
  constructor(private readonly contacts: AiContactsService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<ContactView[]> {
    return this.contacts.list(req.user.customerId);
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() dto: CreateContactDto,
  ): Promise<ContactView> {
    return this.contacts.create(req.user.customerId, dto);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContactDto,
  ): Promise<ContactView> {
    return this.contacts.update(req.user.customerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.contacts.remove(req.user.customerId, id);
  }
}
