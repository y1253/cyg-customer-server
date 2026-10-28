"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceSession = void 0;
const common_1 = require("@nestjs/common");
const ws_1 = __importDefault(require("ws"));
const ai_usage_context_1 = require("../ai/ai-usage.context");
const assistant_tools_1 = require("../assistant/assistant-tools");
const book_switch_1 = require("../assistant/book-switch");
const scope_1 = require("../bookkeeping/scope");
const links_util_1 = require("../assistant/links.util");
const sales_prompt_1 = require("../sales/sales-prompt");
const live_calls_1 = require("./live-calls");
const voice_util_1 = require("./voice.util");
const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
function rawText(raw) {
    if (Array.isArray(raw))
        return Buffer.concat(raw).toString('utf8');
    if (Buffer.isBuffer(raw))
        return raw.toString('utf8');
    return Buffer.from(raw).toString('utf8');
}
const has = (list, type) => list.includes(type);
const FILLER = 'Say only a few natural words to show you are on it, like "Okay, let me check that for you" ' +
    'or "One sec, let me pull that up" — nothing else, no answer yet.';
class VoiceSession {
    ws;
    deps;
    logger = new common_1.Logger(VoiceSession.name);
    openai = null;
    streamSid = null;
    callSid = null;
    claims = null;
    conversation = null;
    prospect = null;
    startedAt = 0;
    model = voice_util_1.DEFAULT_REALTIME_MODEL;
    settings = null;
    recordingSid = null;
    lastUserMessageId = null;
    turnActions = [];
    links = new Map();
    turnTouched = [];
    turnWarning = null;
    responding = false;
    requested = false;
    notes = [];
    toolOutputsPending = false;
    spoke = false;
    fillerWanted = false;
    tools = Promise.resolve();
    toolsRunning = 0;
    closed = false;
    timer = null;
    caller = new voice_util_1.MuLawTrack();
    ai = new voice_util_1.MuLawTrack();
    early = [];
    constructor(ws, deps) {
        this.ws = ws;
        this.deps = deps;
        ws.on('message', (raw) => {
            void this.onSignalWire(rawText(raw)).catch((err) => this.fail(err));
        });
        ws.on('close', () => void this.finish());
        ws.on('error', () => void this.finish());
    }
    async onSignalWire(text) {
        let msg;
        try {
            msg = JSON.parse(text);
        }
        catch {
            return;
        }
        switch (msg.event) {
            case 'start':
                await this.start(msg.start ?? {}, msg.streamSid);
                return;
            case 'media': {
                const payload = msg.media?.payload;
                if (!payload)
                    return;
                if (msg.media?.track && msg.media.track !== 'inbound')
                    return;
                this.caller.writeAt(this.caller.samples, Buffer.from(payload, 'base64'));
                if (this.openai?.readyState === ws_1.default.OPEN) {
                    this.sendOpenAi({
                        type: 'input_audio_buffer.append',
                        audio: payload,
                    });
                }
                else if (this.early.length < 500) {
                    this.early.push(payload);
                }
                return;
            }
            case 'stop':
                this.close();
                return;
        }
    }
    async start(start, fallbackStreamSid) {
        this.streamSid = start.streamSid ?? fallbackStreamSid ?? null;
        this.callSid = start.callSid ?? null;
        const claims = this.deps.calls.verify(start.customParameters?.token);
        if (!claims || !this.callSid) {
            this.logger.warn(`stream refused: ${claims ? 'no call sid' : 'bad token'}`);
            this.close();
            return;
        }
        this.claims = claims;
        if (claims.purpose === 'PROSPECT')
            return this.startProspect();
        const customer = await this.deps.prisma.customer.findFirst({
            where: { id: claims.sub, deletedAt: null },
            select: { name: true },
        });
        if (!customer)
            return this.close();
        this.settings = await this.deps.calls.settings();
        this.conversation = await this.deps.calls.conversationFor(claims);
        await this.deps.calls.started(claims, this.conversation, this.callSid);
        if (claims.purpose !== 'THIRD_PARTY') {
            live_calls_1.liveCalls.addConversation(this.conversation.id, this);
        }
        this.logger.log(`call ${this.callSid} ${claims.dir} customer ${claims.sub} (${claims.purpose ?? 'INBOUND'}) connected`);
        if (claims.dir === 'INBOUND') {
            this.recordingSid = await this.deps.signalwire.startRecording(this.callSid);
        }
        this.timer = setTimeout(() => void this.hangUp('max length'), this.settings.maxMinutes * 60_000);
        const over = await this.deps.assistant.isOverLimit(claims.sub);
        if (!this.deps.openaiKey || over) {
            this.logger.warn(`call ${this.callSid}: AI not available (${over ? 'daily limit' : 'no key'})`);
            return this.hangUp(over ? 'daily limit' : 'no OpenAI key');
        }
        await this.openRealtime(customer.name);
    }
    async startProspect() {
        const claims = this.claims;
        const sales = this.deps.sales;
        if (!sales)
            return this.close();
        this.settings = await this.deps.calls.settings();
        this.prospect = await sales.touch(claims.peer, 'CALL');
        this.startedAt = Date.now();
        this.deps.calls.prospectStarted(this.callSid, claims);
        this.logger.log(`call ${this.callSid} INBOUND prospect ${this.prospect.id} connected`);
        this.timer = setTimeout(() => void this.hangUp('max length'), this.settings.maxMinutes * 60_000);
        const ok = !!this.deps.openaiKey &&
            (await sales.enabled()) &&
            sales.takeCall(this.prospect.phoneE164);
        if (!ok)
            return this.hangUp('salesperson not available');
        live_calls_1.liveCalls.addProspect(this.prospect.phoneE164, this);
        const model = this.deps.model || voice_util_1.DEFAULT_REALTIME_MODEL;
        this.model = model;
        const language = (0, voice_util_1.languageName)(this.settings.language);
        const instructions = await sales.prompt(this.prospect, 'CALL', {
            language,
            maxMinutes: this.settings.maxMinutes,
        });
        this.connectRealtime(model, instructions, [sales_prompt_1.OFFER_SIGNUP_TOOL, sales_prompt_1.TEXT_CALLER_TOOL], (0, sales_prompt_1.salesOpening)(language));
    }
    async openRealtime(customerName) {
        const conversation = this.conversation;
        const claims = this.claims;
        const model = this.deps.model || voice_util_1.DEFAULT_REALTIME_MODEL;
        this.model = model;
        const thirdParty = claims.purpose === 'THIRD_PARTY';
        const instructions = thirdParty
            ? (0, voice_util_1.thirdPartyInstructions)({
                customerName,
                personName: claims.contactName ?? null,
                message: claims.script ?? '',
                language: (0, voice_util_1.languageName)(this.settings.language),
                maxMinutes: this.settings.maxMinutes,
            })
            : await this.deps.assistant.promptFor(conversation, {
                note: await this.callNote(customerName),
            });
        this.connectRealtime(model, instructions, thirdParty ? [] : (0, assistant_tools_1.toolsFor)('VOICE'), this.opening(customerName, claims));
    }
    connectRealtime(model, instructions, tools, opening) {
        const url = `${REALTIME_URL}?model=${encodeURIComponent(model)}`;
        const headers = { Authorization: `Bearer ${this.deps.openaiKey}` };
        this.openai = this.deps.connect
            ? this.deps.connect(url, headers)
            : new ws_1.default(url, { headers });
        this.openai.on('open', () => {
            this.sendOpenAi((0, voice_util_1.realtimeSession)({
                model,
                instructions,
                voice: this.settings.voice,
                tools,
            }));
            for (const p of this.early.splice(0)) {
                this.sendOpenAi({ type: 'input_audio_buffer.append', audio: p });
            }
            this.createResponse({ instructions: opening });
        });
        this.openai.on('message', (raw) => {
            void this.onOpenAi(rawText(raw)).catch((err) => this.fail(err));
        });
        this.openai.on('close', () => this.close());
        this.openai.on('error', (err) => this.fail(err));
    }
    async callNote(customerName) {
        const claims = this.claims;
        const lines = [
            `THIS IS A PHONE CALL with ${customerName} (${claims.peer}).`,
            claims.dir === 'INBOUND'
                ? 'They called our number.'
                : 'We called them to deliver a scheduled message; after it, answer their questions.',
            `The call ends after ${this.settings.maxMinutes} minutes.`,
            `Speak ${(0, voice_util_1.languageName)(this.settings.language)} by default. If the caller speaks another ` +
                'language or asks you to speak one, switch to it at once and keep using it for the rest ' +
                'of the call, texts you send with send_text included.',
        ];
        const conversation = this.conversation;
        if (!conversation.bookChosen) {
            const options = await (0, book_switch_1.bookOptions)(this.deps.prisma, conversation.customerId);
            if (options.length > 1) {
                lines.push(`They have several books: ${options.map((o, i) => `${i + 1} ${o.name}`).join(', ')}. ` +
                    'Before working on their books, ask which one and call switch_book.');
            }
        }
        return lines.join(' ');
    }
    opening(customerName, claims) {
        const first = customerName.trim().split(/\s+/)[0] || 'there';
        const lang = (0, voice_util_1.languageName)(this.settings.language);
        if (claims.purpose === 'THIRD_PARTY') {
            return (`In ${lang}: say hello${claims.contactName ? ` to ${claims.contactName}` : ''}, that you are ` +
                `CYG Finance's AI assistant calling for ${customerName.trim() || 'a client'}, and pass on the message.`);
        }
        if (claims.dir === 'OUTBOUND' && claims.script) {
            return (`In ${lang}: greet ${first} briefly as CYG Finance's assistant, then pass on this message ` +
                `in your own words, as you would say it on the phone (never read it out like a quote): ` +
                `${claims.script} — then ask if they have any questions.`);
        }
        const greeting = this.settings.greeting;
        return greeting
            ? `In ${lang} (translate it if it is written in another language), greet them along these ` +
                `lines, naturally (use their first name, ${first}, if it fits): ${greeting}`
            : `In ${lang}: greet ${first} by first name as CYG Finance's assistant and ask how you can help with their books.`;
    }
    async onOpenAi(text) {
        let ev;
        try {
            ev = JSON.parse(text);
        }
        catch {
            return;
        }
        const type = ev.type ?? '';
        if (has(voice_util_1.RT.audioDelta, type)) {
            const delta = typeof ev.delta === 'string' ? ev.delta : null;
            if (!delta)
                return;
            this.spoke = true;
            this.ai.writeAt(Math.max(this.caller.samples, this.ai.samples), Buffer.from(delta, 'base64'));
            this.sendSignalWire({
                event: 'media',
                streamSid: this.streamSid,
                media: { payload: delta },
            });
        }
        else if (has(voice_util_1.RT.speechStarted, type)) {
            this.sendSignalWire({ event: 'clear', streamSid: this.streamSid });
            if (this.responding)
                this.sendOpenAi({ type: 'response.cancel' });
        }
        else if (has(voice_util_1.RT.responseCreated, type)) {
            this.responding = true;
            this.requested = false;
            this.spoke = false;
        }
        else if (has(voice_util_1.RT.responseDone, type)) {
            this.responding = false;
            this.recordUsage(this.model, 'realtime', ev.response?.usage);
            if (this.fillerWanted && this.toolsRunning > 0) {
                this.fillerWanted = false;
                this.createResponse({ instructions: FILLER, tool_choice: 'none' });
                return;
            }
            this.fillerWanted = false;
            this.answerToolsIfReady();
            this.flushNotes();
        }
        else if (has(voice_util_1.RT.userText, type)) {
            this.recordUsage(voice_util_1.REALTIME_TRANSCRIBE_MODEL, 'transcribe', ev.usage);
            const said = typeof ev.transcript === 'string' ? ev.transcript.trim() : '';
            if (said && this.prospect) {
                await this.deps.sales.save(this.prospect.id, 'CALL', 'USER', said, this.callSid);
            }
            else if (said && this.conversation) {
                const m = await this.deps.assistant.save(this.conversation, 'USER', said);
                this.lastUserMessageId = m.id;
            }
        }
        else if (has(voice_util_1.RT.assistantText, type)) {
            const said = typeof ev.transcript === 'string' ? ev.transcript.trim() : '';
            if (said && this.prospect) {
                await this.deps.sales.save(this.prospect.id, 'CALL', 'ASSISTANT', said, this.callSid);
            }
            else if (said && this.conversation)
                await this.saveAssistant(said);
        }
        else if (has(voice_util_1.RT.toolCall, type)) {
            if (!this.spoke)
                this.fillerWanted = true;
            this.toolsRunning++;
            this.tools = this.tools
                .then(() => this.runTool(ev))
                .catch((err) => this.logger.warn(`call ${this.callSid}: tool failed: ${String(err)}`))
                .finally(() => {
                this.toolsRunning--;
                this.answerToolsIfReady();
                this.flushNotes();
            });
        }
        else if (has(voice_util_1.RT.error, type)) {
            const err = ev.error;
            if (/active response/i.test(err?.message ?? ''))
                this.requested = false;
            this.logger.warn(`call ${this.callSid}: realtime error: ${err?.message ?? text.slice(0, 200)}`);
        }
    }
    answerToolsIfReady() {
        if (this.responding || this.toolsRunning > 0 || !this.toolOutputsPending) {
            return;
        }
        this.toolOutputsPending = false;
        this.createResponse();
    }
    createResponse(response) {
        this.requested = true;
        this.sendOpenAi({
            type: 'response.create',
            ...(response && { response }),
        });
    }
    inject(note) {
        if (this.closed)
            return;
        this.notes.push(note);
        this.flushNotes();
    }
    flushNotes() {
        if (!this.notes.length ||
            this.responding ||
            this.requested ||
            this.toolsRunning > 0 ||
            this.toolOutputsPending ||
            this.openai?.readyState !== ws_1.default.OPEN) {
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
    recordUsage(model, kind, usage) {
        if (!usage)
            return;
        if (this.prospect) {
            this.deps.usage?.recordFor({ customerId: null, bookId: null, companyId: null, feature: 'SALES' }, model, kind, usage, 0);
            return;
        }
        const c = this.conversation;
        if (!c)
            return;
        this.deps.usage?.recordFor({
            customerId: c.customerId,
            bookId: c.bookId,
            companyId: c.companyId,
            feature: 'VOICE',
        }, model, kind, usage, 0);
    }
    async runTool(ev) {
        const callId = typeof ev.call_id === 'string' ? ev.call_id : '';
        const name = typeof ev.name === 'string' ? ev.name : '';
        const args = typeof ev.arguments === 'string' ? ev.arguments : '{}';
        if (this.prospect) {
            const output = name === sales_prompt_1.OFFER_SIGNUP_TOOL.name
                ? await this.deps.sales.offerOnCall(this.prospect.id, this.claims?.to)
                : name === sales_prompt_1.TEXT_CALLER_TOOL.name
                    ? await this.deps.sales.textOnCall(this.prospect.id, this.claims?.to, this.callSid, args)
                    : `Unknown tool ${name}.`;
            this.sendOpenAi({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output },
            });
            this.toolOutputsPending = true;
            return;
        }
        const conversation = await this.freshConversation();
        const scope = (0, scope_1.scopeOf)(conversation);
        const outcome = await (0, ai_usage_context_1.withAiUsage)({ ...scope, feature: 'VOICE' }, () => this.deps.tools.run(name, args, {
            scope,
            messageId: this.lastUserMessageId,
            conversation,
            links: this.links,
        }));
        if (outcome.action)
            this.turnActions.push(outcome.action);
        if (outcome.warning)
            this.turnWarning = outcome.warning;
        if (outcome.attachmentId)
            this.turnTouched.push(outcome.attachmentId);
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
    async saveAssistant(said) {
        const conversation = await this.freshConversation();
        await this.deps.assistant.save(conversation, 'ASSISTANT', (0, links_util_1.fillLinks)(said, this.links), {
            actions: this.turnActions,
            warning: this.turnWarning,
            actedOn: this.turnTouched,
        });
        this.turnActions = [];
        this.turnTouched = [];
        this.turnWarning = null;
    }
    async freshConversation() {
        const id = this.conversation.id;
        const fresh = await this.deps.prisma.aiConversation.findUnique({
            where: { id },
        });
        if (fresh)
            this.conversation = fresh;
        return this.conversation;
    }
    sendOpenAi(event) {
        if (this.openai?.readyState === ws_1.default.OPEN) {
            this.openai.send(JSON.stringify(event));
        }
    }
    sendSignalWire(event) {
        if (this.ws.readyState === ws_1.default.OPEN)
            this.ws.send(JSON.stringify(event));
    }
    async hangUp(reason) {
        this.logger.log(`call ${this.callSid}: hanging up (${reason})`);
        if (this.callSid)
            await this.deps.signalwire.hangup(this.callSid);
        this.close();
    }
    fail(err) {
        this.logger.error(`call ${this.callSid ?? '?'} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    close() {
        if (this.openai && this.openai.readyState <= ws_1.default.OPEN)
            this.openai.close();
        if (this.ws.readyState <= ws_1.default.OPEN)
            this.ws.close();
    }
    async finish() {
        if (this.closed)
            return;
        this.closed = true;
        live_calls_1.liveCalls.remove(this);
        if (this.timer)
            clearTimeout(this.timer);
        this.close();
        if (!this.callSid || !this.claims)
            return;
        if (this.prospect) {
            this.deps.calls.prospectEnded(this.callSid, Math.round((Date.now() - this.startedAt) / 1000));
            this.logger.log(`call ${this.callSid} ended`);
            return;
        }
        if (this.conversation && this.turnActions.length) {
            await this.saveAssistant('(The call ended here.)').catch((err) => this.fail(err));
        }
        const needWav = this.claims.dir === 'INBOUND' && !this.recordingSid;
        const len = Math.max(this.caller.samples, this.ai.samples);
        await this.deps.calls
            .ended(this.callSid, {
            recordingSid: this.recordingSid,
            wav: needWav && len > 0
                ? (0, voice_util_1.muLawStereoWav)(this.caller.toBuffer(len), this.ai.toBuffer(len))
                : null,
        })
            .catch((err) => this.fail(err));
        this.logger.log(`call ${this.callSid} ended`);
    }
}
exports.VoiceSession = VoiceSession;
//# sourceMappingURL=voice-session.js.map