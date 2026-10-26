import {
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
