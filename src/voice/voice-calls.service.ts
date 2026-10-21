import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AiCall, AiConversation } from '@prisma/client';
import { Subject } from 'rxjs';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { SignalWireClient } from '../messaging/signalwire.client';
import { asE164 } from '../messaging/messaging.util';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  DEFAULT_VOICE,
  VOICE_TOKEN_TYPE,
  callStatusOf,
  connectStreamLaml,
  isVoice,
  type CallPurpose,
  type VoiceTokenClaims,
} from './voice.util';

export interface VoiceSettings {
  enabled: boolean;
  voice: string;
  greeting: string | null;
  maxMinutes: number;
}

/** An outbound schedule call that never reached the customer (they get a text / email instead). */
export interface OutboundMissed {
  runId: number;
  status: string;
}

/** What the Communication tab shows for one call. */
export interface CallView {
  id: number;
  direction: string;
  purpose: string;
  status: string;
  startedAt: string;
  durationSec: number | null;
  hasRecording: boolean;
}

/** The longest a scheduled call may ring before it counts as unanswered. */
const RING_SECONDS = 30;

/**
 * step12: the AI's phone calls — the firm's voice settings, the stream token, the
 * `AiCall` rows, placing a call for a schedule, SignalWire's status reports, and the
 * recordings (proxied from SignalWire, or the bridge's own WAV in R2).
 */
@Injectable()
export class VoiceCallsService {
  private readonly logger = new Logger(VoiceCallsService.name);
  private readonly jwt: JwtService;
  /** A schedule call that ended without the customer — `SchedulesService` falls back. */
  readonly outboundMissed$ = new Subject<OutboundMissed>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly signalwire: SignalWireClient,
    private readonly storage: ObjectStorageService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  // ---- settings & config ---------------------------------------------------------------

  /** The admin's settings (internal app, Customer site → AI phone); defaults when unset. */
  async settings(): Promise<VoiceSettings> {
    const row = await this.prisma.customerVoiceSettings
      .findUnique({ where: { singleton: 'GLOBAL' } })
      .catch(() => null);
    return {
      enabled: row?.enabled ?? false,
      voice: isVoice(row?.voice) ? row.voice : DEFAULT_VOICE,
      greeting: row?.greeting?.trim() || null,
      maxMinutes: Math.min(Math.max(row?.maxMinutes ?? 15, 1), 60),
    };
  }

  /** Can the AI place a call right now (on, SignalWire keys, OpenAI key)? */
  async canCall(): Promise<boolean> {
    return (
      (await this.settings()).enabled &&
      this.signalwire.configured &&
      !!this.config.get<string>('OPENAI_API_KEY')?.trim()
    );
  }

  private base(): string {
    return (
      this.config.get<string>('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
      'https://cygfinance.com'
    );
  }

  /** Where SignalWire streams a call's audio (the `VoiceGateway`). */
  streamUrl(): string {
    return (
      this.config.get<string>('VOICE_STREAM_URL')?.trim() ||
      `${this.base().replace(/^http/, 'ws')}/api/voice/stream`
    );
  }

  /** The URL SignalWire reports an outbound call's progress to (signed). */
  statusUrl(): string {
    return `${this.base()}/api/voice/status`;
  }

  sign(claims: Omit<VoiceTokenClaims, 'typ'>, ttlSeconds = 300): string {
    return this.jwt.sign(
      { ...claims, typ: VOICE_TOKEN_TYPE },
      { expiresIn: ttlSeconds },
    );
  }

  /** The token's claims, or null when it is not a live voice-call token. */
  verify(token: string | null | undefined): VoiceTokenClaims | null {
    if (!token) return null;
    try {
      const c = this.jwt.verify<VoiceTokenClaims>(token);
      return c.typ === VOICE_TOKEN_TYPE &&
        typeof c.sub === 'number' &&
        asE164(c.peer)
        ? c
        : null;
    } catch {
      return null;
    }
  }

  // ---- conversations & calls -----------------------------------------------------------

  /**
   * The phone's VOICE conversation — one per customer + phone, like a text thread, so the
   * agent remembers earlier calls. A schedule call works on that schedule's book.
   */
  async conversationFor(claims: VoiceTokenClaims): Promise<AiConversation> {
    const found = await this.prisma.aiConversation.findFirst({
      where: {
        customerId: claims.sub,
        channel: 'VOICE',
        peer: claims.peer,
        attachmentId: null,
      },
      orderBy: { id: 'desc' },
    });
    const book =
      claims.dir === 'OUTBOUND' && claims.companyId !== undefined
        ? {
            companyId: claims.companyId ?? null,
            bookChosen: true,
            awaitingBook: false,
          }
        : null;
    if (found) {
      return book
        ? this.prisma.aiConversation.update({
            where: { id: found.id },
            data: book,
          })
        : found;
    }
    // A new caller's book: the one their texts use, when they chose one there.
    const sms = book
      ? null
      : await this.prisma.aiConversation.findFirst({
          where: {
            customerId: claims.sub,
            channel: { in: ['SMS', 'WHATSAPP'] },
            peer: claims.peer,
            bookChosen: true,
          },
          orderBy: { lastMessageAt: 'desc' },
        });
    return this.prisma.aiConversation.create({
      data: {
        customerId: claims.sub,
        channel: 'VOICE',
        peer: claims.peer,
        title: 'Phone calls',
        companyId: book?.companyId ?? sms?.companyId ?? null,
        bookChosen: book?.bookChosen ?? !!sms,
      },
    });
  }

  /** The call's row, created on its first sight (an inbound call when its stream starts). */
  async started(
    claims: VoiceTokenClaims,
    conversation: AiConversation,
    callSid: string,
  ): Promise<AiCall> {
    const existing = await this.prisma.aiCall.findUnique({
      where: { callSid },
    });
    if (existing) {
      return this.prisma.aiCall.update({
        where: { id: existing.id },
        data: {
          status: 'IN_PROGRESS',
          answeredAt: existing.answeredAt ?? new Date(),
          conversationId: conversation.id,
        },
      });
    }
    return this.prisma.aiCall.create({
      data: {
        customerId: claims.sub,
        companyId: conversation.companyId,
        conversationId: conversation.id,
        callSid,
        direction: claims.dir,
        peer: claims.peer,
        fromNumber: claims.to ?? null,
        purpose: claims.purpose ?? 'INBOUND',
        scheduleRunId: claims.runId ?? null,
        status: 'IN_PROGRESS',
        answeredAt: new Date(),
      },
    });
  }

  /** The stream ended: the call's end, length, and (fallback) the bridge's own recording. */
  async ended(
    callSid: string,
    extra: {
      recordingSid?: string | null;
      wav?: Buffer | null;
      error?: string | null;
    },
  ): Promise<void> {
    const call = await this.prisma.aiCall.findUnique({ where: { callSid } });
    if (!call) return;
    let recordingKey: string | null = null;
    if (extra.wav && !extra.recordingSid && this.storage.configured) {
      recordingKey = `voice/${call.customerId}/${call.callSid}.wav`;
      await this.storage
        .putBuffer(recordingKey, extra.wav, 'audio/wav')
        .catch((err: unknown) => {
          recordingKey = null;
          this.logger.warn(
            `call ${callSid}: recording not stored: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    const end = new Date();
    const from = call.answeredAt ?? call.startedAt;
    await this.prisma.aiCall.update({
      where: { id: call.id },
      data: {
        status: call.status === 'IN_PROGRESS' ? 'COMPLETED' : call.status,
        endedAt: end,
        durationSec: Math.max(
          0,
          Math.round((end.getTime() - from.getTime()) / 1000),
        ),
        ...(extra.recordingSid ? { recordingSid: extra.recordingSid } : {}),
        ...(recordingKey ? { recordingKey } : {}),
        ...(extra.error ? { error: extra.error.slice(0, 512) } : {}),
      },
    });
  }

  /**
   * Phones the customer for a scheduled message (step12): the AI says `script`, then answers
   * questions. Recorded by SignalWire. The call id, or why it could not be placed.
   */
  async callCustomer(input: {
    scope: BookScope;
    peer: string;
    purpose: CallPurpose;
    runId: number;
    script: string;
  }): Promise<{ callSid: string } | { error: string }> {
    const to = asE164(input.peer);
    if (!to) return { error: 'No phone number to call.' };
    if (!(await this.canCall()))
      return { error: 'Phone calls are not set up.' };
    const from = await this.prisma.intakeNumber.findFirst({
      where: { releasedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { phoneNumber: true },
    });
    if (!from) return { error: 'No receipt number to call from.' };
    const claims: Omit<VoiceTokenClaims, 'typ'> = {
      sub: input.scope.customerId,
      peer: to,
      to: from.phoneNumber,
      dir: 'OUTBOUND',
      purpose: input.purpose,
      companyId: input.scope.companyId,
      runId: input.runId,
      script: input.script.slice(0, 1500),
    };
    try {
      const callSid = await this.signalwire.createCall({
        to,
        from: from.phoneNumber,
        laml: connectStreamLaml(this.streamUrl(), {
          // Valid long enough to ring, be answered and connect.
          token: this.sign(claims, 600),
        }),
        statusCallback: this.statusUrl(),
        record: true,
        timeoutSec: RING_SECONDS,
      });
      const conversation = await this.conversationFor({
        ...claims,
        typ: VOICE_TOKEN_TYPE,
      });
      await this.prisma.aiCall.create({
        data: {
          customerId: input.scope.customerId,
          companyId: input.scope.companyId,
          conversationId: conversation.id,
          callSid,
          direction: 'OUTBOUND',
          peer: to,
          fromNumber: from.phoneNumber,
          purpose: input.purpose,
          scheduleRunId: input.runId,
          status: 'RINGING',
        },
      });
      return { callSid };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * SignalWire's status report for a call we placed (signed — `VoiceStatusController`). A
   * schedule call that ended without being answered is handed to the schedule's fallback.
   */
  async onStatus(
    callSid: string,
    rawStatus: string,
    durationSec: number | null,
  ): Promise<void> {
    const call = await this.prisma.aiCall.findUnique({ where: { callSid } });
    if (!call) return;
    const status = callStatusOf(rawStatus);
    const terminal =
      status === 'COMPLETED' || status === 'NO_ANSWER' || status === 'FAILED';
    // A call that was answered stays COMPLETED; the stream's end writes the details.
    const next = call.answeredAt && terminal ? 'COMPLETED' : status;
    await this.prisma.aiCall.update({
      where: { id: call.id },
      data: {
        status: next,
        ...(terminal && !call.endedAt ? { endedAt: new Date() } : {}),
        ...(terminal && durationSec !== null && !call.durationSec
          ? { durationSec }
          : {}),
      },
    });
    if (
      terminal &&
      !call.answeredAt &&
      (status === 'NO_ANSWER' || status === 'FAILED') &&
      call.scheduleRunId
    ) {
      this.outboundMissed$.next({
        runId: call.scheduleRunId,
        status: rawStatus,
      });
    }
  }

  // ---- the Communication tab -----------------------------------------------------------

  async callsFor(
    scope: BookScope,
    before: Date | null,
    take: number,
  ): Promise<CallView[]> {
    const rows = await this.prisma.aiCall.findMany({
      where: {
        ...scopeWhere(scope),
        ...(before ? { startedAt: { lt: before } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take,
    });
    return rows.map(toCallView);
  }

  /**
   * A call's recording, proxied. SignalWire's recording is looked up the first time it is
   * played (it is ready only after the call) and remembered.
   */
  async recording(
    scope: BookScope,
    id: number,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const call = await this.prisma.aiCall.findFirst({
      where: { id, ...scopeWhere(scope) },
    });
    if (!call) throw new NotFoundException('Call not found');
    let sid = call.recordingSid;
    if (!sid && !call.recordingKey) {
      const list = await this.signalwire.listRecordings(call.callSid);
      sid = list.find((r) => r.status !== 'absent')?.sid ?? null;
      if (sid) {
        await this.prisma.aiCall.update({
          where: { id: call.id },
          data: { recordingSid: sid },
        });
      }
    }
    if (sid) {
      return {
        body: await this.signalwire.fetchRecording(sid),
        contentType: 'audio/mpeg',
        filename: `call-${call.id}.mp3`,
      };
    }
    if (call.recordingKey) {
      return {
        body: await this.storage.getBuffer(call.recordingKey),
        contentType: 'audio/wav',
        filename: `call-${call.id}.wav`,
      };
    }
    throw new NotFoundException('This call has no recording');
  }
}

export function toCallView(c: AiCall): CallView {
  return {
    id: c.id,
    direction: c.direction,
    purpose: c.purpose,
    status: c.status,
    startedAt: c.startedAt.toISOString(),
    durationSec: c.durationSec,
    hasRecording:
      !!c.recordingSid ||
      !!c.recordingKey ||
      (c.status === 'COMPLETED' && !!c.answeredAt),
  };
}
