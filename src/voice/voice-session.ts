import { Logger } from '@nestjs/common';
import type { AiConversation, Prospect } from '@prisma/client';
import WebSocket from 'ws';
import { withAiUsage } from '../ai/ai-usage.context';
import type { AiUsageService } from '../ai-usage/ai-usage.service';
import type { AgentAction, AssistantTools } from '../assistant/assistant-tools';
import { toolsFor } from '../assistant/assistant-tools';
import type { AssistantService } from '../assistant/assistant.service';
import { bookOptions } from '../assistant/book-switch';
import { scopeOf, type BookScope } from '../bookkeeping/scope';
import { fillLinks, type LinkBook } from '../assistant/links.util';
import type { SignalWireClient } from '../messaging/signalwire.client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  OFFER_SIGNUP_TOOL,
  TEXT_CALLER_TOOL,
  salesOpening,
} from '../sales/sales-prompt';
import type { SalesService } from '../sales/sales.service';
import { liveCalls, type LiveCall } from './live-calls';
import type { VoiceCallsService, VoiceSettings } from './voice-calls.service';
import {
  DEFAULT_REALTIME_MODEL,
  MuLawTrack,
  REALTIME_TRANSCRIBE_MODEL,
  RT,
  muLawStereoWav,
  languageName,
  realtimeSession,
  thirdPartyInstructions,
  END_CALL_TOOL,
  parseEndCall,
  type VoiceTokenClaims,
} from './voice.util';

/** What a session needs from the app (passed in by `VoiceGateway`). */
export interface VoiceDeps {
  prisma: PrismaService;
  calls: VoiceCallsService;
  assistant: AssistantService;
  tools: AssistantTools;
  signalwire: SignalWireClient;
  /** step12: AI cost tracking (absent in the spec). */
  usage?: AiUsageService;
  /** step12f: the AI salesperson for a PROSPECT call (absent in the spec). */
  sales?: SalesService;
  openaiKey: string | null;
  model: string | null;
  /** Opens the Realtime socket — injectable so the spec can hand in a fake. */
  connect?: (url: string, headers: Record<string, string>) => WebSocket;
}

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

type Obj = Record<string, unknown>;

/** A WebSocket frame as text (it may arrive as a Buffer, an ArrayBuffer or fragments). */
function rawText(raw: WebSocket.RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return Buffer.from(raw).toString('utf8');
}
const has = (list: readonly string[], type: string) => list.includes(type);

/** The SignalWire mark placed after the goodbye; the call ends when it is echoed. */
const END_MARK = 'end_call';
/** Hang up anyway this long after end_call, if the mark never comes back. */
const END_FALLBACK_MS = 12_000;

/** How often a statement re-read on a call is checked, and for how long at most. */
const WATCH_EVERY_MS = 15_000;
const WATCH_FOR_MS = 20 * 60_000;

/** `retry_statement`'s statementId argument. */
function statementIdOf(args: string): number | null {
  try {
    const v = Number((JSON.parse(args) as { statementId?: unknown }).statementId);
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The note the model gets when a statement re-read on this call is finished. Pure. */
export function statementDoneNote(
  statementId: number,
  row: { status: string; error: string | null; filename: string },
): string {
  const head = `[System note, not from the caller] The statement you re-read on this call (#${statementId}, "${row.filename}") is finished:`;
  if (row.status === 'DONE') {
    return `${head} it was read and now matches the bank's totals — its transactions are in the books. Tell the caller now, briefly.`;
  }
  return (
    `${head} it still could not be read (${row.status}). The reason: ${row.error ?? 'unknown'}. ` +
    'Tell the caller now, briefly and plainly. Do not promise a review or a timeline you cannot see.'
  );
}

/** What the AI says while a tool runs, when it went to the tool without a word. */
const FILLER =
  'Say only a few natural words to show you are on it, like "Okay, let me check that for you" ' +
  'or "One sec, let me pull that up" — nothing else, no answer yet.';

/**
 * step12: ONE phone call between a customer and the AI — the bridge between SignalWire's
 * media stream (μ-law 8 kHz over this server's WebSocket) and OpenAI Realtime, with the
 * agent being the SAME agent as the chat:
 *
 * - `instructions` = `AssistantService.promptFor(conversation)` (rules, book, style VOICE),
 *   `tools` = `toolsFor('VOICE')` run through `AssistantTools.run` on the conversation's
 *   book (so it can search, file, rename… and `send_text` a link),
 * - every sentence is saved as an `AiMessage` (channel VOICE) — the call is in the same
 *   history as texts and the Assistant tab,
 * - the caller can interrupt (barge-in: SignalWire `clear`; OpenAI cancels the answer itself).
 *
 * Never throws out of a socket handler: a failure ends the call politely and is logged.
 */
export class VoiceSession implements LiveCall {
  private readonly logger = new Logger(VoiceSession.name);
  private openai: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private claims: VoiceTokenClaims | null = null;
  private conversation: AiConversation | null = null;
  /** step12f: a PROSPECT call — the caller has no account; no conversation, no books. */
  private prospect: Prospect | null = null;
  private startedAt = 0;
  /** step12: the Realtime model, for cost tracking. */
  private model = DEFAULT_REALTIME_MODEL;
  private settings: VoiceSettings | null = null;
  private recordingSid: string | null = null;
  /** The customer's last saved sentence — the "message" a tool's action belongs to. */
  private lastUserMessageId: number | null = null;
  private turnActions: AgentAction[] = [];
  /** step12: links get_link issued on this call; `send_text` swaps the placeholders back. */
  private readonly links: LinkBook = new Map();
  private turnTouched: number[] = [];
  private turnWarning: string | null = null;
  private responding = false;
  /** A `response.create` was sent and its `response.created` has not come back yet. */
  private requested = false;
  /** step12h: notes from outside the call (a text, the strong AI) waiting for a quiet moment. */
  private readonly notes: string[] = [];
  private toolOutputsPending = false;
  /** The current response has put audio on the line (a tool call after it is not silent). */
  private spoke = false;
  /** A tool call came with nothing said: speak a short "let me check" while it runs. */
  private fillerWanted = false;
  /** Tool calls run one after another, without holding up the audio events. */
  private tools: Promise<void> = Promise.resolve();
  private toolsRunning = 0;
  private closed = false;
  private timer: NodeJS.Timeout | null = null;
  /** end_call ran: hang up once the goodbye has played; no new answers meanwhile. */
  private ending = false;
  private endMarkSent = false;
  /** Statements re-read on this call, watched so the AI can say when they are done. */
  private readonly watched = new Map<number, NodeJS.Timeout>();
  /** Fallback recording when SignalWire would not record: left = caller, right = AI. */
  private readonly caller = new MuLawTrack();
  private readonly ai = new MuLawTrack();
  /** Queue of SignalWire audio that arrived before OpenAI was ready. */
  private early: string[] = [];

  constructor(
    private readonly ws: WebSocket,
    private readonly deps: VoiceDeps,
  ) {
    ws.on('message', (raw) => {
      void this.onSignalWire(rawText(raw)).catch((err: unknown) =>
        this.fail(err),
      );
    });
    ws.on('close', () => void this.finish());
    ws.on('error', () => void this.finish());
  }

  // ---- SignalWire side ------------------------------------------------------------------

  private async onSignalWire(text: string): Promise<void> {
    let msg: {
      event?: string;
      start?: {
        streamSid?: string;
        callSid?: string;
        customParameters?: Record<string, string>;
      };
      streamSid?: string;
      media?: { payload?: string; track?: string };
      mark?: { name?: string };
    };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    switch (msg.event) {
      case 'start':
        await this.start(msg.start ?? {}, msg.streamSid);
        return;
      case 'media': {
        const payload = msg.media?.payload;
        if (!payload) return;
        if (msg.media?.track && msg.media.track !== 'inbound') return;
        this.caller.writeAt(
          this.caller.samples,
          Buffer.from(payload, 'base64'),
        );
        if (this.openai?.readyState === WebSocket.OPEN) {
          this.sendOpenAi({
            type: 'input_audio_buffer.append',
            audio: payload,
          });
        } else if (this.early.length < 500) {
          this.early.push(payload);
        }
        return;
      }
      case 'mark':
        // SignalWire plays our audio, then echoes the mark: the goodbye has been heard.
        if (this.ending && msg.mark?.name === END_MARK) this.close();
        return;
      case 'stop':
        this.close();
        return;
    }
  }

  private async start(
    start: {
      streamSid?: string;
      callSid?: string;
      customParameters?: Record<string, string>;
    },
    fallbackStreamSid?: string,
  ): Promise<void> {
    this.streamSid = start.streamSid ?? fallbackStreamSid ?? null;
    this.callSid = start.callSid ?? null;
    const claims = this.deps.calls.verify(start.customParameters?.token);
    if (!claims || !this.callSid) {
      this.logger.warn(
        `stream refused: ${claims ? 'no call sid' : 'bad token'}`,
      );
      this.close();
      return;
    }
    this.claims = claims;
    if (claims.purpose === 'PROSPECT') return this.startProspect();
    const customer = await this.deps.prisma.customer.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: { name: true },
    });
    if (!customer) return this.close();
    this.settings = await this.deps.calls.settings();
    this.conversation = await this.deps.calls.conversationFor(claims);
    await this.deps.calls.started(claims, this.conversation, this.callSid);
    // step12h: the strong AI's result for a complaint made on this call reaches it live.
    if (claims.purpose !== 'THIRD_PARTY') {
      liveCalls.addConversation(this.conversation.id, this);
    }
    this.logger.log(
      `call ${this.callSid} ${claims.dir} customer ${claims.sub} (${claims.purpose ?? 'INBOUND'}) connected`,
    );
    // SignalWire records a call we placed (Record=true); an incoming one is recorded now.
    if (claims.dir === 'INBOUND') {
      this.recordingSid = await this.deps.signalwire.startRecording(
        this.callSid,
      );
    }
    this.timer = setTimeout(
      () => void this.hangUp('max length'),
      this.settings.maxMinutes * 60_000,
    );

    const over = await this.deps.assistant.isOverLimit(claims.sub);
    if (!this.deps.openaiKey || over) {
      this.logger.warn(
        `call ${this.callSid}: AI not available (${over ? 'daily limit' : 'no key'})`,
      );
      // Without the AI there is nothing to say: end the call (the customer can text instead).
      return this.hangUp(over ? 'daily limit' : 'no OpenAI key');
    }
    await this.openRealtime(customer.name);
  }

  /**
   * step12f: a phone with no account called — the AI salesperson. Not recorded, no
   * `AiCall` (it needs a customer): the transcript is `ProspectMessage` rows and the cost
   * a `CommCall` with no customer.
   */
  private async startProspect(): Promise<void> {
    const claims = this.claims!;
    const sales = this.deps.sales;
    if (!sales) return this.close();
    this.settings = await this.deps.calls.settings();
    this.prospect = await sales.touch(claims.peer, 'CALL');
    this.startedAt = Date.now();
    this.deps.calls.prospectStarted(this.callSid!, claims);
    this.logger.log(
      `call ${this.callSid} INBOUND prospect ${this.prospect.id} connected`,
    );
    this.timer = setTimeout(
      () => void this.hangUp('max length'),
      this.settings.maxMinutes * 60_000,
    );
    const ok =
      !!this.deps.openaiKey &&
      (await sales.enabled()) &&
      sales.takeCall(this.prospect.phoneE164);
    if (!ok) return this.hangUp('salesperson not available');
    // step12h: a text they send to this number while on the phone reaches this call.
    liveCalls.addProspect(this.prospect.phoneE164, this);
    const model = this.deps.model || DEFAULT_REALTIME_MODEL;
    this.model = model;
    const language = languageName(this.settings.language);
    const instructions = await sales.prompt(this.prospect, 'CALL', {
      language,
      maxMinutes: this.settings.maxMinutes,
    });
    this.connectRealtime(
      model,
      instructions,
      [OFFER_SIGNUP_TOOL, TEXT_CALLER_TOOL],
      salesOpening(language),
    );
  }

  // ---- OpenAI side --------------------------------------------------------------------

  private async openRealtime(customerName: string): Promise<void> {
    const conversation = this.conversation!;
    const claims = this.claims!;
    const model = this.deps.model || DEFAULT_REALTIME_MODEL;
    this.model = model;
    // step12c: a call to someone else for the customer knows only the message.
    const thirdParty = claims.purpose === 'THIRD_PARTY';
    const instructions = thirdParty
      ? thirdPartyInstructions({
          customerName,
          personName: claims.contactName ?? null,
          message: claims.script ?? '',
          language: languageName(this.settings!.language),
          maxMinutes: this.settings!.maxMinutes,
        })
      : await this.deps.assistant.promptFor(conversation, {
          note: await this.callNote(customerName),
        });
    this.connectRealtime(
      model,
      instructions,
      thirdParty ? [END_CALL_TOOL] : toolsFor('VOICE'),
      this.opening(customerName, claims),
    );
  }

  /** Opens the Realtime socket with this prompt and tools; the AI speaks `opening` first. */
  private connectRealtime(
    model: string,
    instructions: string,
    tools: Parameters<typeof realtimeSession>[0]['tools'],
    opening: string,
  ): void {
    const url = `${REALTIME_URL}?model=${encodeURIComponent(model)}`;
    const headers = { Authorization: `Bearer ${this.deps.openaiKey}` };
    this.openai = this.deps.connect
      ? this.deps.connect(url, headers)
      : new WebSocket(url, { headers });
    this.openai.on('open', () => {
      this.sendOpenAi(
        realtimeSession({
          model,
          instructions,
          voice: this.settings!.voice,
          tools,
        }),
      );
      for (const p of this.early.splice(0)) {
        this.sendOpenAi({ type: 'input_audio_buffer.append', audio: p });
      }
      // The AI speaks first: the greeting, or the scheduled message.
      this.createResponse({ instructions: opening });
    });
    this.openai.on('message', (raw) => {
      void this.onOpenAi(rawText(raw)).catch((err: unknown) => this.fail(err));
    });
    this.openai.on('close', () => this.close());
    this.openai.on('error', (err) => this.fail(err));
  }

  /** What the agent is told about THIS call, on top of its usual prompt. */
  private async callNote(customerName: string): Promise<string> {
    const claims = this.claims!;
    const lines = [
      `THIS IS A PHONE CALL with ${customerName} (${claims.peer}).`,
      claims.dir === 'INBOUND'
        ? 'They called our number.'
        : 'We called them to deliver a scheduled message; after it, answer their questions.',
      `The call ends after ${this.settings!.maxMinutes} minutes.`,
      // ⚠️ "Switch at once" switched to Hebrew over a garbled noise transcribed as a foreign
      // word (2026-10-28): a phone line's noise transcribes as fragments of any language.
      `Speak ${languageName(this.settings!.language)} by default. If the caller asks you to ` +
        'speak another language, or clearly speaks whole sentences in one, switch to it and keep ' +
        'using it for the rest of the call, texts you send with send_text included. Never switch ' +
        'because of a single word or a short, unclear fragment.',
      'Phone lines are noisy: when what you heard is unclear, only a word or two, or sounds like ' +
        'noise, say nothing about its content — at most ask once, briefly, to repeat. Never answer a ' +
        'guess. When you have asked a question, wait for the answer; never fill a silence with more talk.',
      'Never promise what no tool did: no "staff / a specialist will review it", no "in a few business ' +
        "days\", no \"I'll let you know\" — unless a tool result or a note on this call says it will happen.",
    ];
    const conversation = this.conversation!;
    if (!conversation.bookChosen) {
      const options = await bookOptions(
        this.deps.prisma,
        conversation.customerId,
      );
      if (options.length > 1) {
        lines.push(
          `They have several books: ${options.map((o, i) => `${i + 1} ${o.name}`).join(', ')}. ` +
            'Before working on their books, ask which one and call switch_book.',
        );
      }
    }
    return lines.join(' ');
  }

  /** The instruction for the first thing the AI says. */
  private opening(customerName: string, claims: VoiceTokenClaims): string {
    const first = customerName.trim().split(/\s+/)[0] || 'there';
    const lang = languageName(this.settings!.language);
    if (claims.purpose === 'THIRD_PARTY') {
      return (
        `In ${lang}: say hello${claims.contactName ? ` to ${claims.contactName}` : ''}, that you are ` +
        `CYG Finance's AI assistant calling for ${customerName.trim() || 'a client'}, and pass on the message.`
      );
    }
    if (claims.dir === 'OUTBOUND' && claims.script) {
      return (
        `In ${lang}: greet ${first} briefly as CYG Finance's assistant, then pass on this message ` +
        `in your own words, as you would say it on the phone (never read it out like a quote): ` +
        `${claims.script} — then ask if they have any questions.`
      );
    }
    const greeting = this.settings!.greeting;
    return greeting
      ? `In ${lang} (translate it if it is written in another language), greet them along these ` +
          `lines, naturally (use their first name, ${first}, if it fits): ${greeting}`
      : `In ${lang}: greet ${first} by first name as CYG Finance's assistant and ask how you can help with their books.`;
  }

  private async onOpenAi(text: string): Promise<void> {
    let ev: Record<string, unknown> & { type?: string };
    try {
      ev = JSON.parse(text) as typeof ev;
    } catch {
      return;
    }
    const type = ev.type ?? '';
    if (has(RT.audioDelta, type)) {
      const delta = typeof ev.delta === 'string' ? ev.delta : null;
      if (!delta) return;
      this.spoke = true;
      this.ai.writeAt(
        Math.max(this.caller.samples, this.ai.samples),
        Buffer.from(delta, 'base64'),
      );
      this.sendSignalWire({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: delta },
      });
    } else if (has(RT.speechStarted, type)) {
      // Barge-in: stop what is playing on the phone. OpenAI cancels the answer itself
      // (`interrupt_response: true`); a second `response.cancel` from here raced it and
      // logged "Cancellation failed: no active response found" dozens of times a call.
      this.sendSignalWire({ event: 'clear', streamSid: this.streamSid });
    } else if (has(RT.responseCreated, type)) {
      if (this.ending) {
        // The other end (a voicemail menu, a "Hello?") must not start a new answer.
        this.sendOpenAi({ type: 'response.cancel' });
        return;
      }
      this.responding = true;
      this.requested = false;
      this.spoke = false;
    } else if (has(RT.responseDone, type)) {
      this.responding = false;
      if (this.ending) this.sendEndMark();
      this.recordUsage(
        this.model,
        'realtime',
        (ev.response as Obj | undefined)?.usage,
      );
      if (this.fillerWanted && this.toolsRunning > 0) {
        // The model went straight to a tool without a word: never leave the caller in silence.
        this.fillerWanted = false;
        this.createResponse({ instructions: FILLER, tool_choice: 'none' });
        return;
      }
      this.fillerWanted = false;
      this.answerToolsIfReady();
      this.flushNotes();
    } else if (has(RT.userText, type)) {
      this.recordUsage(REALTIME_TRANSCRIBE_MODEL, 'transcribe', ev.usage);
      const said =
        typeof ev.transcript === 'string' ? ev.transcript.trim() : '';
      if (said && this.prospect) {
        await this.deps.sales!.save(
          this.prospect.id,
          'CALL',
          'USER',
          said,
          this.callSid,
        );
      } else if (said && this.conversation) {
        const m = await this.deps.assistant.save(
          this.conversation,
          'USER',
          said,
        );
        this.lastUserMessageId = m.id;
      }
    } else if (has(RT.assistantText, type)) {
      const said =
        typeof ev.transcript === 'string' ? ev.transcript.trim() : '';
      if (said && this.prospect) {
        await this.deps.sales!.save(
          this.prospect.id,
          'CALL',
          'ASSISTANT',
          said,
          this.callSid,
        );
      } else if (said && this.conversation) await this.saveAssistant(said);
    } else if (has(RT.toolCall, type)) {
      if (!this.spoke) this.fillerWanted = true;
      this.toolsRunning++;
      this.tools = this.tools
        .then(() => this.runTool(ev))
        .catch((err: unknown) =>
          this.logger.warn(`call ${this.callSid}: tool failed: ${String(err)}`),
        )
        .finally(() => {
          this.toolsRunning--;
          this.answerToolsIfReady();
          this.flushNotes();
        });
    } else if (has(RT.error, type)) {
      const err = ev.error as { message?: string } | undefined;
      // A refused response.create never gets its response.created.
      if (/active response/i.test(err?.message ?? '')) this.requested = false;
      this.logger.warn(
        `call ${this.callSid}: realtime error: ${err?.message ?? text.slice(0, 200)}`,
      );
    }
  }

  /** Every tool result is in and nothing is speaking: the model answers from them. */
  /**
   * end_call: let the goodbye play out, then hang up. The audio is sent ahead of playback,
   * so the end is a SignalWire `mark` placed after it (echoed once played), with a timer in
   * case the mark never comes back.
   */
  private endCall(): void {
    if (this.ending) return;
    this.ending = true;
    if (!this.responding) this.sendEndMark();
    setTimeout(() => this.close(), END_FALLBACK_MS).unref?.();
  }

  private sendEndMark(): void {
    if (this.endMarkSent) return;
    this.endMarkSent = true;
    this.sendSignalWire({
      event: 'mark',
      streamSid: this.streamSid,
      mark: { name: END_MARK },
    });
  }

  private answerToolsIfReady(): void {
    if (this.ending) return;
    if (this.responding || this.toolsRunning > 0 || !this.toolOutputsPending) {
      return;
    }
    this.toolOutputsPending = false;
    this.createResponse();
  }

  private createResponse(response?: Obj): void {
    this.requested = true;
    this.sendOpenAi({
      type: 'response.create',
      ...(response && { response }),
    });
  }

  /**
   * step12h (`LiveCall`): a note from outside the call — a text the caller just sent, the
   * strong AI's result. Given to the model as a message it answers at once, but never while
   * it is speaking or waiting on a tool ("Conversation already has an active response").
   */
  inject(note: string): void {
    if (this.closed) return;
    this.notes.push(note);
    this.flushNotes();
  }

  private flushNotes(): void {
    if (
      !this.notes.length ||
      this.responding ||
      this.requested ||
      this.toolsRunning > 0 ||
      this.toolOutputsPending ||
      this.openai?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    this.sendOpenAi({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: this.notes.splice(0).join('\n') },
        ],
      },
    });
    this.createResponse();
  }

  /** step12: one Realtime response's / transcription's usage → this customer's VOICE cost. */
  private recordUsage(
    model: string,
    kind: 'realtime' | 'transcribe',
    usage: unknown,
  ): void {
    if (!usage) return;
    if (this.prospect) {
      this.deps.usage?.recordFor(
        { customerId: null, bookId: null, companyId: null, feature: 'SALES' },
        model,
        kind,
        usage,
        0,
      );
      return;
    }
    const c = this.conversation;
    if (!c) return;
    this.deps.usage?.recordFor(
      {
        customerId: c.customerId,
        bookId: c.bookId,
        companyId: c.companyId,
        feature: 'VOICE',
      },
      model,
      kind,
      usage,
      0,
    );
  }

  /** One tool call from the model, run exactly as the chat would, its result handed back. */
  private async runTool(ev: Record<string, unknown>): Promise<void> {
    const callId = typeof ev.call_id === 'string' ? ev.call_id : '';
    const name = typeof ev.name === 'string' ? ev.name : '';
    const args = typeof ev.arguments === 'string' ? ev.arguments : '{}';
    if (this.prospect) {
      // step12f: the sign-up text, asked for on the call; step12h: any text to the caller.
      const output =
        name === OFFER_SIGNUP_TOOL.name
          ? await this.deps.sales!.offerOnCall(
              this.prospect.id,
              this.claims?.to,
            )
          : name === TEXT_CALLER_TOOL.name
            ? await this.deps.sales!.textOnCall(
                this.prospect.id,
                this.claims?.to,
                this.callSid,
                args,
              )
            : `Unknown tool ${name}.`;
      this.sendOpenAi({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output },
      });
      this.toolOutputsPending = true;
      return;
    }
    if (name === END_CALL_TOOL.name && this.claims?.purpose === 'THIRD_PARTY') {
      const ended = parseEndCall(args);
      if (ended && this.callSid) {
        this.deps.calls.notePersonOutcome(this.callSid, ended);
      }
      this.logger.log(
        `call ${this.callSid}: end_call ${ended?.outcome ?? '(bad arguments)'}`,
      );
      this.sendOpenAi({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: 'The call is ending. Say nothing more.',
        },
      });
      // No `toolOutputsPending`: the model must not answer this.
      this.endCall();
      return;
    }
    const conversation = await this.freshConversation();
    const scope = scopeOf(conversation);
    const outcome = await withAiUsage({ ...scope, feature: 'VOICE' }, () =>
      this.deps.tools.run(name, args, {
        scope,
        messageId: this.lastUserMessageId,
        conversation,
        links: this.links,
      }),
    );
    if (outcome.action) this.turnActions.push(outcome.action);
    if (name === 'retry_statement' && outcome.action?.ok) {
      this.watchStatement(scope, statementIdOf(args));
    }
    if (outcome.warning) this.turnWarning = outcome.warning;
    if (outcome.attachmentId) this.turnTouched.push(outcome.attachmentId);
    this.sendOpenAi({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: outcome.content,
      },
    });
    this.toolOutputsPending = true;
  }

  /**
   * After `retry_statement` the AI used to say "I'll let you know when it's done" and could
   * not: nothing told it (Madam recovery's call, 2026-10-28 — the caller asked three times).
   * Now the statement is checked every `WATCH_EVERY_MS` while the call is up, and when it is
   * read the result is handed to the model as a note (`inject`), which says it out loud.
   */
  private watchStatement(scope: BookScope, statementId: number | null): void {
    if (!statementId || this.closed || this.watched.has(statementId)) return;
    const started = Date.now();
    const tick = async (): Promise<void> => {
      if (this.closed) return this.unwatch(statementId);
      const row = await this.deps.prisma.bankStatement.findFirst({
        where: {
          id: statementId,
          customerId: scope.customerId,
          bookId: scope.bookId,
          deletedAt: null,
        },
        select: { status: true, error: true, filename: true },
      });
      if (!row) return this.unwatch(statementId);
      if (row.status === 'PENDING' || row.status === 'PROCESSING') {
        if (Date.now() - started > WATCH_FOR_MS) this.unwatch(statementId);
        return;
      }
      this.unwatch(statementId);
      this.inject(statementDoneNote(statementId, row));
    };
    this.watched.set(
      statementId,
      setInterval(() => {
        void tick().catch((err: unknown) => {
          this.logger.warn(
            `call ${this.callSid}: statement #${statementId} watch failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.unwatch(statementId);
        });
      }, WATCH_EVERY_MS),
    );
  }

  private unwatch(statementId: number): void {
    const t = this.watched.get(statementId);
    if (t) clearInterval(t);
    this.watched.delete(statementId);
  }

  /** The AI's sentence, with what it changed while answering. */
  private async saveAssistant(said: string): Promise<void> {
    const conversation = await this.freshConversation();
    await this.deps.assistant.save(
      conversation,
      'ASSISTANT',
      fillLinks(said, this.links),
      {
        actions: this.turnActions,
        warning: this.turnWarning,
        actedOn: this.turnTouched,
      },
    );
    this.turnActions = [];
    this.turnTouched = [];
    this.turnWarning = null;
  }

  /** `switch_book` may have moved the conversation to another book mid-call. */
  private async freshConversation(): Promise<AiConversation> {
    const id = this.conversation!.id;
    const fresh = await this.deps.prisma.aiConversation.findUnique({
      where: { id },
    });
    if (fresh) this.conversation = fresh;
    return this.conversation!;
  }

  // ---- plumbing ---------------------------------------------------------------------

  private sendOpenAi(event: unknown): void {
    if (this.openai?.readyState === WebSocket.OPEN) {
      this.openai.send(JSON.stringify(event));
    }
  }

  private sendSignalWire(event: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(event));
  }

  private async hangUp(reason: string): Promise<void> {
    this.logger.log(`call ${this.callSid}: hanging up (${reason})`);
    if (this.callSid) await this.deps.signalwire.hangup(this.callSid);
    this.close();
  }

  private fail(err: unknown): void {
    this.logger.error(
      `call ${this.callSid ?? '?'} FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  private close(): void {
    if (this.openai && this.openai.readyState <= WebSocket.OPEN)
      this.openai.close();
    if (this.ws.readyState <= WebSocket.OPEN) this.ws.close();
  }

  /** Once, when either side goes away: the call's row is finished. */
  private async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    liveCalls.remove(this);
    if (this.timer) clearTimeout(this.timer);
    for (const id of [...this.watched.keys()]) this.unwatch(id);
    this.close();
    if (!this.callSid || !this.claims) return;
    if (this.prospect) {
      this.deps.calls.prospectEnded(
        this.callSid,
        Math.round((Date.now() - this.startedAt) / 1000),
      );
      this.logger.log(`call ${this.callSid} ended`);
      return;
    }
    // A tool that ran just before the hang-up is still recorded under the call.
    if (this.conversation && this.turnActions.length) {
      await this.saveAssistant('(The call ended here.)').catch((err: unknown) =>
        this.fail(err),
      );
    }
    // A call we placed is recorded by SignalWire anyway; an incoming one whose recording
    // could not be started keeps the bridge's own copy.
    const needWav = this.claims.dir === 'INBOUND' && !this.recordingSid;
    const len = Math.max(this.caller.samples, this.ai.samples);
    await this.deps.calls
      .ended(this.callSid, {
        recordingSid: this.recordingSid,
        wav:
          needWav && len > 0
            ? muLawStereoWav(this.caller.toBuffer(len), this.ai.toBuffer(len))
            : null,
      })
      .catch((err: unknown) => this.fail(err));
    this.logger.log(`call ${this.callSid} ended`);
  }
}
