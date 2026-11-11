import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Book, BookScopeGuard } from '../bookkeeping/book-scope.guard';
import type { BookScope } from '../bookkeeping/scope';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import { VoiceCallsService, type TranscriptLine } from './voice-calls.service';
import { signalWireSignatureValid } from './voice.util';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { firmReach } from '../messaging/reach';
import { PrismaService } from '../prisma/prisma.service';

export class CallMeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  statementId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  attachmentId?: number;
}

/**
 * `POST /api/voice/status` — SignalWire reports a call we PLACED (a schedule call): ringing,
 * answered, no answer… Unauthenticated like every SignalWire webhook, so the signature IS
 * the gate: HMAC with `SIGNALWIRE_SIGN_KEY` over the exact URL we gave it (rebuilt from
 * config, never from the request — behind nginx the request's own URL differs). A missing
 * key fails CLOSED.
 */
@Controller('voice')
export class VoiceStatusController {
  constructor(
    private readonly calls: VoiceCallsService,
    private readonly config: ConfigService,
  ) {}

  @Post('status')
  @HttpCode(204)
  async status(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const signature =
      (req.headers['x-signalwire-signature'] as string | undefined) ??
      (req.headers['x-twilio-signature'] as string | undefined);
    const ok = signalWireSignatureValid(
      this.calls.statusUrl(),
      body,
      signature,
      this.config.get<string>('SIGNALWIRE_SIGN_KEY')?.trim(),
    );
    if (!ok) throw new ForbiddenException();
    const sid = typeof body.CallSid === 'string' ? body.CallSid : null;
    const status = typeof body.CallStatus === 'string' ? body.CallStatus : '';
    const duration = Number(body.CallDuration);
    if (sid) {
      await this.calls.onStatus(
        sid,
        status,
        Number.isFinite(duration) ? duration : null,
      );
    }
  }
}

/**
 * `GET /api/bookkeeping/calls/:id/recording` — a call's audio, for this book only;
 * `…/:id/transcript` (step12g) — what was said on it.
 */
@Controller('bookkeeping/calls')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class VoiceRecordingController {
  constructor(private readonly calls: VoiceCallsService) {}

  @Get(':id/recording')
  async recording(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const r = await this.calls.recording(scope, id);
    res.set({
      'Content-Type': r.contentType,
      'Content-Length': String(r.body.length),
      'Content-Disposition': `inline; filename="${r.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(r.body);
  }

  @Get(':id/transcript')
  transcript(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ lines: TranscriptLine[] }> {
    return this.calls.transcript(scope, id);
  }
}

/**
 * step2 (2026-11-08): the "Call me" button of a statement's / attachment's chat.
 * `GET` = can we call them now (phone on the account, calls set up); `POST` places the
 * call about that chat (`VoiceCallsService.callMeFromChat`).
 */
@Controller('bookkeeping/call-me')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class CallMeController {
  constructor(private readonly calls: VoiceCallsService) {}

  @Get()
  async available(
    @Book() scope: BookScope,
  ): Promise<{ available: boolean; voice: boolean; hasPhone: boolean }> {
    return this.calls.callMeState(scope.customerId);
  }

  /**
   * With a statement / attachment: a call about that chat. step2 (2026-11-09): with
   * neither — the chat bubble's "Call me" — a general call from the website.
   */
  @Post()
  async callMe(
    @Book() scope: BookScope,
    @Body() dto: CallMeDto,
  ): Promise<{ ok: boolean; message: string }> {
    const placed =
      dto.statementId || dto.attachmentId
        ? await this.calls.callMeFromChat(scope, dto)
        : await this.calls.callMeFromWebsite(scope);
    return placed.ok
      ? { ok: true, message: placed.summary }
      : { ok: false, message: placed.error };
  }
}

/** step2 (2026-11-09): at most one welcome text per customer this often (pm2 fork mode: in memory). */
const WELCOME_EVERY_MS = 10 * 60_000;

/** The welcome text — what the AI number is for, so the customer saves it. */
export function welcomeText(
  name: string,
  whatsapp: boolean,
  voice: boolean,
): string {
  const first = name.trim().split(/\s+/)[0];
  const ways = [
    'text',
    ...(whatsapp ? ['WhatsApp'] : []),
    ...(voice ? ['call'] : []),
  ];
  const how =
    ways.length > 1
      ? `${ways.slice(0, -1).join(', ')} or ${ways.at(-1)}`
      : ways[0];
  return (
    `Hi${first ? ` ${first}` : ''}, this is the CYG Finance AI assistant. Save this number: ` +
    `${how} me any time about your books, or send a photo of a receipt and I'll file it. ` +
    `Reply STOP to stop texts.`
  );
}

/**
 * step2 (2026-11-09): the chat bubble's "Text me a welcome" — our receipt number texts the
 * customer's own phone (never one typed here), so they have it saved. Recorded as a
 * `CommMessage` with purpose WELCOME.
 */
@Controller('bookkeeping/welcome-text')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class WelcomeTextController {
  private readonly lastSent = new Map<number, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: CustomerMessenger,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async send(
    @Book() scope: BookScope,
  ): Promise<{ ok: boolean; message: string }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: scope.customerId, deletedAt: null },
      select: { name: true, phoneE164: true },
    });
    if (!customer?.phoneE164)
      throw new BadRequestException(
        'Add your phone number first, then we can text you.',
      );
    const last = this.lastSent.get(scope.customerId) ?? 0;
    if (Date.now() - last < WELCOME_EVERY_MS)
      throw new HttpException(
        'We just texted you — check your messages.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const reach = await firmReach(this.prisma, this.config);
    const outcome = await this.messenger.send({
      channel: 'SMS',
      to: customer.phoneE164,
      body: welcomeText(customer.name, reach.whatsapp.length > 0, reach.voice),
      meta: {
        customerId: scope.customerId,
        bookId: scope.bookId,
        companyId: scope.companyId,
        purpose: 'WELCOME',
      },
    });
    if (outcome !== 'sent')
      return {
        ok: false,
        message:
          outcome === 'opted-out'
            ? 'Your phone said STOP to our texts — text START to our number to turn them back on.'
            : 'We could not text you right now — please try again later.',
      };
    this.lastSent.set(scope.customerId, Date.now());
    return {
      ok: true,
      message: `Sent to the number ending ${customer.phoneE164.slice(-4)}.`,
    };
  }
}
