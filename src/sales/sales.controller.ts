import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IntakeSystemGuard } from '../customer-auth/intake-system.guard';
import { ProspectReplyDto } from './dto/prospect-reply.dto';
import { SalesService, type SalesReply } from './sales.service';

/**
 * step12f: `/api/intake-system/prospect` — called by the INTERNAL API only, for a text /
 * WhatsApp from a phone with no account (after the contact-relay and YES checks). The
 * internal API sends the answer itself; `reply: null` = send the fixed offer instead.
 */
@Controller('intake-system')
@UseGuards(IntakeSystemGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post('prospect')
  @HttpCode(200)
  prospect(@Body() dto: ProspectReplyDto): Promise<SalesReply> {
    return this.sales.replyToText(dto);
  }
}
