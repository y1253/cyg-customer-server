import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * `POST /api/contact` — the public website's contact form. Unauthenticated by design;
   * the service throttles per IP. `req.ip` is the visitor because `main.ts` trusts one
   * proxy hop (nginx).
   */
  @Post()
  @HttpCode(202)
  async create(
    @Body() dto: CreateContactDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.contact.submit(dto, req.ip ?? 'unknown');
    return { ok: true };
  }
}
