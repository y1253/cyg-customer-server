import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IntakeSystemGuard } from '../customer-auth/intake-system.guard';
import { ProspectLiveDto } from './dto/prospect-live.dto';
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

  /**
   * step12h: asked FIRST for a text from a phone with no account — `live: true` = that phone
   * is on a call with the salesperson and the text went to the call (send no text reply).
   */
  @Post('prospect-live')
  @HttpCode(200)
  prospectLive(@Body() dto: ProspectLiveDto): Promise<{ live: boolean }> {
    return this.sales.liveText(dto);
  }
}
