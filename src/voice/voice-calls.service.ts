import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AiCall, AiConversation } from '@prisma/client';
import { CommUsageService } from '../comm-usage/comm-usage.service';
import { Subject } from 'rxjs';
import {
  AssistantTools,
  type PersonTarget,
  type ToolContext,
} from '../assistant/assistant-tools';
import {
  CustomerOutbox,
  type OutboxChannel,
} from '../assistant/customer-outbox.service';
import { ensureDefaultBook, legacyBook } from '../bookkeeping/books';
import { scopeOf, scopeWhere, type BookScope } from '../bookkeeping/scope';
import { SignalWireClient } from '../messaging/signalwire.client';
import { asE164 } from '../messaging/messaging.util';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE,
  VOICE_TOKEN_TYPE,
  callStatusOf,
  connectStreamLaml,
  isLanguage,
  isVoice,
  type CallPurpose,
  type VoiceTokenClaims,
} from './voice.util';

export interface VoiceSettings {
  enabled: boolean;
  voice: string;
  greeting: string | null;
  maxMinutes: number;
  /** The language every call starts in (the caller can switch). */
  language: string;
}

/**
 * An outbound schedule call that never reached the customer (they get a text / email
 * instead): a built-in schedule's run (`runId`) or, step12b, an AI schedule's (`aiRunId`).
 */
export interface OutboundMissed {
  runId: number | null;
  aiRunId: number | null;
  status: string;
}

/** step12b: the most calls the AI places to one customer a day ("call me" + AI schedules). */
const DEFAULT_AI_CALLS_PER_DAY = 5;

/** What the Communication tab shows for one call. */
export interface CallView {
  id: number;
  direction: string;
  purpose: string;
  status: string;
  startedAt: string;
  /** step12c: when it was picked up / hung up (null = never / not yet). */
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  hasRecording: boolean;
  /** step12c: the two ends — the caller's number and the number called, E.164. */
  fromNumber: string | null;
  toNumber: string | null;
  /** step12c: who the call was with — the contact's name (THIRD_PARTY) or the customer's. */
  withName: string;
  /** step12c: THIRD_PARTY — the call was with this contact, not the customer. */
  contactName: string | null;
}

/** step12c: a call_person call in flight — who asked, so they hear how it went. */
interface PersonCall {
  /** The conversation the customer asked in. */
  originConversationId: number;
  name: string | null;
  phone: string;
}

/** The longest a scheduled call may ring before it counts as unanswered. */
const RING_SECONDS = 30;

/**
 * step12: the AI's phone calls — the firm's voice settings, the stream token, the
 * `AiCall` rows, placing a call for a schedule, SignalWire's status reports, and the
 * recordings (proxied from SignalWire, or the bridge's own WAV in R2).
 */
@Injectable()
export class VoiceCallsService implements OnModuleInit {
  private readonly logger = new Logger(VoiceCallsService.name);
  private readonly jwt: JwtService;
  /** A schedule call that ended without the customer — `SchedulesService` falls back. */
  readonly outboundMissed$ = new Subject<OutboundMissed>();
  /** step12c: call_person calls by call sid, until their outcome is reported (in memory). */
  private readonly personCalls = new Map<string, PersonCall>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly signalwire: SignalWireClient,
    private readonly storage: ObjectStorageService,
    /** step12b: the assistant's call_me tool is answered here (absent in old specs). */
    @Optional() private readonly tools?: AssistantTools,
    /** step12c: how a call_person call went is sent back to the customer. */
    @Optional() private readonly outbox?: CustomerOutbox,
    /** step12d: each call's length and cost (`CommCall`). */
    @Optional() private readonly usage?: CommUsageService,
  ) {
    this.jwt = new JwtService({
      secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
    });
  }

  onModuleInit(): void {
    this.tools?.setCallHandler((ctx, about) => this.callMeNow(ctx, about));
    this.tools?.setPersonCallHandler((ctx, person, message) =>
      this.callPersonNow(ctx, person, message),
    );
  }

  /**
   * step12b: the assistant's `call_me` — phones the customer's OWN number (never one the
   * model names) a few seconds after the reply, so the text answer arrives first.
   */
  async callMeNow(
    ctx: ToolContext,
    about: string,
  ): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: ctx.scope.customerId, deletedAt: null },
      select: { phoneE164: true },
    });
    if (!customer?.phoneE164) {
      return {
        ok: false,
        error:
          'There is no phone number on the account — they can add one on the Account page.',
      };
    }
    if (!(await this.canCall()))
      return { ok: false, error: 'Phone calls are not set up right now.' };
    if (await this.overCallLimit(ctx.scope.customerId)) {
      return {
        ok: false,
        error:
          "Today's limit of calls from the assistant is reached — try again tomorrow.",
      };
    }
    const scope = ctx.scope;
    const peer = customer.phoneE164;
    setTimeout(() => {
      void this.callCustomer({
        scope,
        peer,
        purpose: 'REQUESTED',
        script: `They asked you to call them about: ${about}. Start with that.`,
      }).then((r) => {
        if ('error' in r)
          this.logger.warn(
            `call_me for customer ${scope.customerId} not placed: ${r.error}`,
          );
      });
    }, 4000);
    return {
      ok: true,
      summary: `Calling the customer at the number ending ${peer.slice(-4)}`,
    };
  }

  /**
   * step12c: the assistant's `call_person` — phones someone else for the customer and passes
   * on `message`; how it went goes back to the conversation the customer asked in.
   */
  async callPersonNow(
    ctx: ToolContext,
    person: PersonTarget,
    message: string,
  ): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
    if (!(await this.canCall()))
      return { ok: false, error: 'Phone calls are not set up right now.' };
    if (await this.overCallLimit(ctx.scope.customerId)) {
      return {
        ok: false,
        error:
          "Today's limit of calls from the assistant is reached — try again tomorrow.",
      };
    }
    const scope = ctx.scope;
    const origin = ctx.conversation?.id ?? null;
    const label = person.name ?? person.phone;
    setTimeout(() => {
      void this.callCustomer({
        scope,
        peer: person.phone,
        purpose: 'THIRD_PARTY',
        script: message,
        contactId: person.contactId,
        contactName: person.name,
      }).then((r) => {
        if ('error' in r) {
          this.logger.warn(
            `call_person for customer ${scope.customerId} not placed: ${r.error}`,
          );
          if (origin)
            void this.reportToCustomer(
              origin,
              `I couldn't call ${label}: ${r.error}`,
            );
        } else if (origin) {
          this.personCalls.set(r.callSid, {
            originConversationId: origin,
            name: person.name,
            phone: person.phone,
          });
        }
      });
    }, 4000);
    return { ok: true, summary: `Calling ${label} (${person.phone})` };
  }

  /**
   * step12c: tells the customer how a call_person call went, in the conversation they asked
   * in — on its channel (a website chat just gets the message; a phone call gets a text).
   */
  private async reportPersonCall(call: AiCall): Promise<void> {
    const pending = this.personCalls.get(call.callSid);
    if (!pending) return;
    this.personCalls.delete(call.callSid);
    const label = pending.name
      ? `${pending.name} (${pending.phone})`
      : pending.phone;
    let text: string;
    if (!call.answeredAt) {
      text = `I called ${label} but nobody answered, so your message was not delivered. Want me to text them instead, or try again later?`;
    } else {
      const said = await this.prisma.aiMessage.findMany({
        where: {
          conversationId: call.conversationId,
          role: 'USER',
          createdAt: { gte: call.startedAt },
        },
        orderBy: { id: 'asc' },
        select: { text: true },
      });
      const words = said
        .map((m) => m.text.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 600);
      text = `I called ${label} and gave them your message.${words ? ` They said: "${words}"` : ''}`;
    }
    await this.reportToCustomer(pending.originConversationId, text);
  }

  private async reportToCustomer(
    conversationId: number,
    text: string,
  ): Promise<void> {
    try {
      const origin = await this.prisma.aiConversation.findUnique({
        where: { id: conversationId },
      });
      if (!origin) return;
      const scope = scopeOf(origin);
      const channel: OutboxChannel | null =
        origin.channel === 'SMS' ||
        origin.channel === 'WHATSAPP' ||
        origin.channel === 'EMAIL'
          ? origin.channel
          : origin.channel === 'VOICE'
            ? 'SMS'
            : null;
      if (channel && this.outbox) {
        const sent = await this.outbox.send(scope, channel, text);
        if (sent.ok) return;
      }
      // The website chat (or a send that failed): the message waits in the conversation.
      await this.prisma.aiMessage.create({
        data: {
          conversationId: origin.id,
          customerId: origin.customerId,
          bookId: origin.bookId,
          companyId: origin.companyId,
          channel: origin.channel,
          role: 'ASSISTANT',
          text,
        },
      });
      await this.prisma.aiConversation.update({
        where: { id: origin.id },
        data: { lastMessageAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `call_person report not delivered: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The AI already phoned this customer the most times allowed today (UTC day). */
  async overCallLimit(customerId: number): Promise<boolean> {
    const max = Number(this.config.get<string>('AI_CALLS_PER_DAY'));
    const limit =
      Number.isFinite(max) && max >= 0 ? max : DEFAULT_AI_CALLS_PER_DAY;
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const count = await this.prisma.aiCall.count({
      where: {
        customerId,
        direction: 'OUTBOUND',
        purpose: { in: ['REQUESTED', 'AI_SCHEDULE', 'THIRD_PARTY'] },
        startedAt: { gte: since },
      },
    });
    return count >= limit;
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
      language: isLanguage(row?.language) ? row.language : DEFAULT_LANGUAGE,
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
      if (c.typ !== VOICE_TOKEN_TYPE || !asE164(c.peer)) return null;
      // step12f: a caller with no account — inbound only, and never a customer's id.
      if (c.purpose === 'PROSPECT') {
        return c.dir === 'INBOUND' ? { ...c, sub: 0 } : null;
      }
      return typeof c.sub === 'number' ? c : null;
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
    const pinned =
      claims.dir === 'OUTBOUND' &&
      (claims.bookId !== undefined || claims.companyId !== undefined)
        ? await legacyBook(this.prisma, claims.sub, claims)
        : null;
    const book = pinned
      ? {
          bookId: pinned.bookId,
          companyId: pinned.companyId,
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
    const fallback =
      book || sms ? null : await ensureDefaultBook(this.prisma, claims.sub);
    return this.prisma.aiConversation.create({
      data: {
        customerId: claims.sub,
        channel: 'VOICE',
        peer: claims.peer,
        title:
          claims.purpose === 'THIRD_PARTY'
            ? `Calls with ${claims.contactName ?? claims.peer}`
            : 'Phone calls',
        bookId: (book ?? sms ?? fallback)!.bookId,
        companyId: (book ?? sms ?? fallback)!.companyId,
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
    const call = await this.prisma.aiCall.create({
      data: {
        customerId: claims.sub,
        bookId: conversation.bookId,
        companyId: conversation.companyId,
        conversationId: conversation.id,
        callSid,
        direction: claims.dir,
        peer: claims.peer,
        fromNumber: claims.to ?? null,
        purpose: claims.purpose ?? 'INBOUND',
        contactId: claims.contactId ?? null,
        scheduleRunId: claims.runId ?? null,
        status: 'IN_PROGRESS',
        answeredAt: new Date(),
      },
    });
    this.recordStart(call);
    return call;
  }

  /** step12d: the call's cost row (`CommCall`), next to its `AiCall`. */
  private recordStart(call: AiCall): void {
    const inbound = call.direction === 'INBOUND';
    this.usage?.callStarted({
      customerId: call.customerId,
      bookId: call.bookId,
      companyId: call.companyId,
      aiCallId: call.id,
      callSid: call.callSid,
      direction: inbound ? 'IN' : 'OUT',
      purpose: call.purpose,
      from: inbound ? call.peer : call.fromNumber,
      to: inbound ? call.fromNumber : call.peer,
    });
  }

  /** step12f: a PROSPECT call (no customer, no `AiCall`) — only its cost row. */
  prospectStarted(callSid: string, claims: VoiceTokenClaims): void {
    this.usage?.callStarted({
      customerId: null,
      callSid,
      direction: 'IN',
      purpose: 'PROSPECT',
      from: claims.peer,
      to: claims.to ?? null,
    });
  }

  /** step12f: a PROSPECT call ended after `durationSec` (never recorded). */
  prospectEnded(callSid: string, durationSec: number): void {
    this.usage?.callEnded(callSid, { durationSec, recorded: false });
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
    const durationSec = Math.max(
      0,
      Math.round((end.getTime() - from.getTime()) / 1000),
    );
    // SignalWire records an outbound call (`Record=true`) and an inbound one it accepted
    // the recording of; the bridge's own WAV fallback costs nothing there.
    this.usage?.callEnded(callSid, {
      durationSec,
      recorded:
        call.direction === 'OUTBOUND' ||
        !!(extra.recordingSid ?? call.recordingSid),
    });
    await this.prisma.aiCall.update({
      where: { id: call.id },
      data: {
        status: call.status === 'IN_PROGRESS' ? 'COMPLETED' : call.status,
        endedAt: end,
        durationSec,
        ...(extra.recordingSid ? { recordingSid: extra.recordingSid } : {}),
        ...(recordingKey ? { recordingKey } : {}),
        ...(extra.error ? { error: extra.error.slice(0, 512) } : {}),
      },
    });
    if (call.purpose === 'THIRD_PARTY') {
      const fresh = await this.prisma.aiCall.findUnique({
        where: { id: call.id },
      });
      if (fresh) await this.reportPersonCall(fresh);
    }
  }

  /**
   * Phones the customer for a scheduled message (step12): the AI says `script`, then answers
   * questions. Recorded by SignalWire. The call id, or why it could not be placed.
   */
  async callCustomer(input: {
    scope: BookScope;
    peer: string;
    purpose: CallPurpose;
    /** A built-in schedule's run (`BookScheduleRun`). */
    runId?: number | null;
    /** step12b: an AI schedule's run (`AiScheduleRun`). */
    aiScheduleRunId?: number | null;
    script: string;
    /** step12c, THIRD_PARTY: the person called. */
    contactId?: number | null;
    contactName?: string | null;
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
      bookId: input.scope.bookId,
      runId: input.runId ?? null,
      script: input.script.slice(0, 1500),
      ...(input.purpose === 'THIRD_PARTY'
        ? {
            contactId: input.contactId ?? null,
            contactName: input.contactName ?? null,
          }
        : {}),
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
      const call = await this.prisma.aiCall.create({
        data: {
          customerId: input.scope.customerId,
          bookId: input.scope.bookId,
          companyId: input.scope.companyId,
          conversationId: conversation.id,
          callSid,
          direction: 'OUTBOUND',
          peer: to,
          fromNumber: from.phoneNumber,
          purpose: input.purpose,
          contactId: input.contactId ?? null,
          scheduleRunId: input.runId ?? null,
          aiScheduleRunId: input.aiScheduleRunId ?? null,
          status: 'RINGING',
        },
      });
      this.recordStart(call);
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
    if (terminal && durationSec !== null) {
      this.usage?.callEnded(callSid, {
        durationSec,
        recorded: call.direction === 'OUTBOUND' || !!call.recordingSid,
      });
    }
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
    if (terminal && !call.answeredAt && call.purpose === 'THIRD_PARTY') {
      await this.reportPersonCall(call);
    }
    if (
      terminal &&
      !call.answeredAt &&
      (status === 'NO_ANSWER' || status === 'FAILED') &&
      (call.scheduleRunId || call.aiScheduleRunId)
    ) {
      this.outboundMissed$.next({
        runId: call.scheduleRunId,
        aiRunId: call.aiScheduleRunId,
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
      include: {
        contact: { select: { name: true } },
        customer: { select: { name: true } },
      },
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

export function toCallView(
  c: AiCall & {
    contact?: { name: string } | null;
    customer?: { name: string } | null;
  },
): CallView {
  // `peer` is the other end; `fromNumber` our receipt number. Who dialled decides the order.
  const inbound = c.direction === 'INBOUND';
  const thirdParty = c.purpose === 'THIRD_PARTY';
  const contactName = thirdParty ? (c.contact?.name ?? null) : null;
  return {
    id: c.id,
    direction: c.direction,
    purpose: c.purpose,
    status: c.status,
    startedAt: c.startedAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    fromNumber: inbound ? c.peer : c.fromNumber,
    toNumber: inbound ? c.fromNumber : c.peer,
    withName: thirdParty
      ? (contactName ?? c.peer)
      : c.customer?.name?.trim() || 'you',
    contactName,
    durationSec: c.durationSec,
    hasRecording:
      !!c.recordingSid ||
      !!c.recordingKey ||
      (c.status === 'COMPLETED' && !!c.answeredAt),
  };
}
