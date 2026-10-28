import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Prospect, type ProspectMessage } from '@prisma/client';
import { withAiUsage } from '../ai/ai-usage.context';
import { OpenAiClient, type AgentMessage } from '../ai/openai.client';
import { InstructionsService } from '../assistant/instructions.service';
import { readPricing } from '../billing/pricing';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { asE164 } from '../messaging/messaging.util';
import { firmReach } from '../messaging/reach';
import { PrismaService } from '../prisma/prisma.service';
import { liveCalls } from '../voice/live-calls';
import {
  CALL_SIGNUP_TEXT,
  DailyCounter,
  MAX_CALL_TEXTS,
  OFFER_SIGNUP_TOOL,
  salesPrompt,
  withSignupLine,
  type ProspectChannel,
} from './sales-prompt';

/** The offer is still answerable by YES (the internal API's OFFER_TTL_MS). */
const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY = 20;
const MAX_TOOL_ROUNDS = 2;

export interface SalesReply {
  /** null = the salesperson could not answer (off, a limit, an AI failure): use the fixed offer. */
  reply: string | null;
  /** The answer carries the "Reply YES" line. */
  offered: boolean;
}

/**
 * step12f: the AI salesperson for phones with no account (see `sales-prompt.ts`). Texts come
 * from the INTERNAL API (`/intake-system/prospect`) and are answered there; calls are a
 * `VoiceSession` with purpose PROSPECT. It only ever ANSWERS: the one message it sends by
 * itself is the sign-up text a caller asked for (`offerOnCall`).
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);
  private readonly perPhone = new DailyCounter();
  private readonly total = new DailyCounter();
  private readonly callsPerPhone = new DailyCounter();
  /** step12h: `text_caller` texts sent per call (by call sid). */
  private readonly callTexts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly openai: OpenAiClient,
    private readonly messenger: CustomerMessenger,
    @Optional() private readonly instructions?: InstructionsService,
  ) {}

  private num(key: string, fallback: number): number {
    const n = Number(this.config.get<string>(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private model(): string {
    return (
      this.config.get<string>('OPENAI_ASSISTANT_MODEL')?.trim() || 'gpt-4.1'
    );
  }

  /** The admin's switch (internal → Customer site → AI phone) and an OpenAI key. */
  async enabled(): Promise<boolean> {
    if (!this.openai.configured) return false;
    const row = await this.prisma.customerVoiceSettings
      .findUnique({
        where: { singleton: 'GLOBAL' },
        select: { salesEnabled: true },
      })
      .catch(() => null);
    return !!row?.salesEnabled;
  }

  /** A call from this phone may still get the salesperson today. */
  takeCall(phone: string): boolean {
    return this.callsPerPhone.take(
      phone,
      this.num('SALES_CALLS_PER_PHONE_PER_DAY', 3),
    );
  }

  /** The phone's row, created on first contact; `lastContactAt` moved to now. */
  async touch(rawPhone: string, channel: ProspectChannel): Promise<Prospect> {
    const phoneE164 = asE164(rawPhone);
    if (!phoneE164) throw new Error('not a phone number');
    const upsert = () =>
      this.prisma.prospect.upsert({
        where: { phoneE164 },
        create: { phoneE164, firstChannel: channel },
        update: { lastContactAt: new Date() },
      });
    try {
      return await upsert();
    } catch (err) {
      // Two first messages at once: the other one created it.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return upsert();
      }
      throw err;
    }
  }

  save(
    prospectId: number,
    channel: ProspectChannel,
    role: 'USER' | 'ASSISTANT',
    text: string,
    callSid?: string | null,
  ): Promise<ProspectMessage> {
    return this.prisma.prospectMessage.create({
      data: {
        prospectId,
        channel,
        role,
        text: text.slice(0, 20_000),
        callSid: callSid ?? null,
      },
    });
  }

  private offeredRecently(p: Prospect): boolean {
    return (
      !!p.signupOfferedAt &&
      Date.now() - p.signupOfferedAt.getTime() <= OFFER_TTL_MS
    );
  }

  private markOffered(id: number, channel: ProspectChannel) {
    return this.prisma.prospect.update({
      where: { id },
      data: { signupOfferedAt: new Date(), signupOfferChannel: channel },
    });
  }

  /** The whole prompt for this prospect's channel (shared by texts and calls). */
  async prompt(
    p: Prospect,
    channel: ProspectChannel,
    call?: { language: string; maxMinutes: number },
  ): Promise<string> {
    const [pricing, reach, extras] = await Promise.all([
      readPricing(this.prisma).catch(() => null),
      firmReach(this.prisma, this.config).catch(() => null),
      this.instructions?.sales().catch(() => undefined),
    ]);
    return salesPrompt(
      {
        channel,
        today: new Date().toISOString().slice(0, 10),
        pricing,
        reach,
        offered: this.offeredRecently(p),
        language: call?.language,
        maxMinutes: call?.maxMinutes,
      },
      extras,
    );
  }

  /** The recent conversation, every channel, oldest first. */
  private async history(prospectId: number): Promise<AgentMessage[]> {
    const rows = await this.prisma.prospectMessage.findMany({
      where: { prospectId },
      orderBy: { id: 'desc' },
      take: HISTORY,
    });
    return rows.reverse().map(
      (m): AgentMessage =>
        m.role === 'USER'
          ? {
              role: 'user',
              content: m.channel === 'CALL' ? `(on a call) ${m.text}` : m.text,
            }
          : { role: 'assistant', content: m.text },
    );
  }

  /** One text / WhatsApp from a prospect → the salesperson's answer (saved both ways). */
  async replyToText(input: {
    channel: 'SMS' | 'WHATSAPP';
    phone: string;
    text: string;
  }): Promise<SalesReply> {
    const none: SalesReply = { reply: null, offered: false };
    const text = input.text.trim();
    if (!text || !(await this.enabled())) return none;
    const phone = asE164(input.phone);
    if (!phone) return none;
    if (
      !this.perPhone.take(
        phone,
        this.num('SALES_REPLIES_PER_PHONE_PER_DAY', 30),
      )
    ) {
      return none;
    }
    if (!this.total.take('all', this.num('SALES_REPLIES_PER_DAY', 500))) {
      this.logger.warn('daily salesperson limit reached');
      return none;
    }
    let prospect = await this.touch(phone, input.channel);
    const history = await this.history(prospect.id);
    await this.save(prospect.id, input.channel, 'USER', text);
    const system = await this.prompt(prospect, input.channel);

    let offered = false;
    const answer = await withAiUsage(
      { customerId: null, bookId: null, companyId: null, feature: 'SALES' },
      async () => {
        const messages: AgentMessage[] = [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: text },
        ];
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const last = round === MAX_TOOL_ROUNDS;
          const r = await this.openai.chatMessages({
            model: this.model(),
            messages,
            tools: last ? undefined : [OFFER_SIGNUP_TOOL],
            maxTokens: 500,
            timeoutMs: 60_000,
          });
          if (!r.toolCalls.length || last) return r.content?.trim() || null;
          messages.push({
            role: 'assistant',
            content: r.content,
            toolCalls: r.toolCalls,
          });
          for (const call of r.toolCalls) {
            let content = `Unknown tool ${call.name}.`;
            if (call.name === OFFER_SIGNUP_TOOL.name) {
              offered = true;
              content =
                'Done: the "Reply YES" line is added under your answer. Write only a short, warm answer.';
            }
            messages.push({ role: 'tool', toolCallId: call.id, content });
          }
        }
        return null;
      },
    ).catch((err: unknown) => {
      this.logger.warn(
        `salesperson ${input.channel} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
    if (!answer) return none;
    if (offered) prospect = await this.markOffered(prospect.id, input.channel);
    const reply = withSignupLine(answer, offered);
    await this.save(prospect.id, input.channel, 'ASSISTANT', reply);
    return { reply, offered };
  }

  /**
   * `offer_signup` on a call: the ONE text a caller gets, from the number they called. Its
   * YES is answered by the internal API, which reads `Prospect.signupOfferedAt`.
   */
  async offerOnCall(
    prospectId: number,
    from: string | null | undefined,
  ): Promise<string> {
    const p = await this.prisma.prospect.findUnique({
      where: { id: prospectId },
    });
    if (!p) return 'Could not send the text.';
    if (p.customerId) {
      return 'They already have an account now: tell them to text or call this number anytime.';
    }
    if (
      p.signupOfferChannel === 'CALL' &&
      p.signupOfferedAt &&
      Date.now() - p.signupOfferedAt.getTime() < 10 * 60_000
    ) {
      return 'The sign-up text was already sent a moment ago: tell them to reply YES to it.';
    }
    const sent = await this.messenger.send({
      channel: 'SMS',
      to: p.phoneE164,
      from: from ?? null,
      body: CALL_SIGNUP_TEXT,
      meta: { customerId: null, purpose: 'SIGNUP_OFFER' },
    });
    if (sent !== 'sent') {
      this.logger.warn(`call sign-up text for prospect ${p.id}: ${sent}`);
      return sent === 'opted-out'
        ? 'They opted out of our texts, so no text can be sent. Tell them they can sign up at cygfinance.com instead.'
        : 'The text could not be sent. Tell them they can sign up at cygfinance.com instead.';
    }
    await this.markOffered(p.id, 'CALL');
    await this.save(p.id, 'CALL', 'ASSISTANT', `[texted] ${CALL_SIGNUP_TEXT}`);
    return 'Texted. Tell them to reply YES to that text and their account opens right away on this number.';
  }

  /**
   * step12h `text_caller`: a text to the caller while the call goes on (a link, a question
   * they can answer by text). From the number they called; at most `MAX_CALL_TEXTS` a call.
   */
  async textOnCall(
    prospectId: number,
    from: string | null | undefined,
    callSid: string | null,
    rawArgs: string,
  ): Promise<string> {
    let message = '';
    try {
      const args = JSON.parse(rawArgs || '{}') as { message?: unknown };
      if (typeof args.message === 'string') message = args.message.trim();
    } catch {
      // handled below
    }
    if (!message) return 'Nothing was sent: the message was empty.';
    const key = callSid ?? `prospect-${prospectId}`;
    const sent = this.callTexts.get(key) ?? 0;
    if (sent >= MAX_CALL_TEXTS) {
      return 'No more texts on this call — tell them instead.';
    }
    const p = await this.prisma.prospect.findUnique({
      where: { id: prospectId },
    });
    if (!p) return 'Could not send the text.';
    const body = message.slice(0, 600);
    const outcome = await this.messenger.send({
      channel: 'SMS',
      to: p.phoneE164,
      from: from ?? null,
      body,
      meta: { customerId: null, purpose: 'SALES_TEXT' },
    });
    if (outcome !== 'sent') {
      this.logger.warn(`call text for prospect ${p.id}: ${outcome}`);
      return outcome === 'opted-out'
        ? 'They opted out of our texts, so nothing can be sent. Say it out loud instead.'
        : 'The text could not be sent. Say it out loud instead.';
    }
    this.callTexts.set(key, sent + 1);
    if (this.callTexts.size > 500) this.callTexts.clear();
    await this.save(p.id, 'CALL', 'ASSISTANT', `[texted] ${body}`, callSid);
    return 'Texted. Tell them you just sent it; anything they text back comes to you on this call.';
  }

  /**
   * step12h: a text from a phone with no account (from the INTERNAL API, before it answers
   * the text itself). When that phone is on a call with the salesperson right now, the text
   * goes to the call — saved, and handed to the agent to react out loud — and `live` tells
   * the internal API to send no text reply.
   */
  async liveText(input: {
    phone: string;
    text: string;
    /** A note from our side (e.g. "their account is open") rather than their words. */
    system?: boolean;
  }): Promise<{ live: boolean }> {
    const phone = asE164(input.phone);
    if (!phone) return { live: false };
    const text = input.text.trim().slice(0, 1500);
    const note = input.system
      ? `[Note from CYG Finance, not said by the caller: ${text}]`
      : `[The caller just texted you, while on this call: "${text}"]`;
    if (!liveCalls.toProspect(phone, note)) return { live: false };
    if (!input.system) {
      const p = await this.prisma.prospect.findUnique({
        where: { phoneE164: phone },
      });
      if (p) await this.save(p.id, 'SMS', 'USER', text);
    }
    this.logger.log(
      `live call text for ${phone.slice(0, -4)}****${input.system ? ' (note)' : ''}`,
    );
    return { live: true };
  }
}
