"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceSession = exports.KEEP_PROMISE_NOTE = void 0;
exports.promisedAction = promisedAction;
exports.attachmentDoneNote = attachmentDoneNote;
exports.statementDoneNote = statementDoneNote;
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
const END_MARK = 'end_call';
const END_FALLBACK_MS = 12_000;
const WATCH_EVERY_MS = 15_000;
const WATCH_FOR_MS = 20 * 60_000;
function statementIdOf(args) {
    return idArg(args, 'statementId');
}
function idArg(args, key) {
    try {
        const v = Number(JSON.parse(args)[key]);
        return Number.isInteger(v) && v > 0 ? v : null;
    }
    catch {
        return null;
    }
}
function promisedAction(said) {
    const t = said.toLowerCase().replace(/’/g, "'");
    if (!t.trim() || /\?\s*$/.test(t.trim()))
        return false;
    return /\b(let me|i'm going to|i am going to|i'll (now |go ahead and |just )?(look|find|search|check|attach|match|pull|split|move|fix|read|go|get|do|start)|i will (now )?(look|find|search|check|attach|match|pull|split|fix)|one moment|just a moment|give me a (moment|second)|let's (go ahead and )?(find|look|search|check|attach|match))\b/.test(t);
}
exports.KEEP_PROMISE_NOTE = '[System note, not from the caller] You just told the caller you would do something, but you called no tool, so nothing is happening and they are waiting in silence. Do it NOW with the right tool call — or, if no tool can do it, say so plainly in one sentence.';
function attachmentDoneNote(attachmentId, row, family = []) {
    const head = `[System note, not from the caller] The file you re-read on this call (#${attachmentId}, "${row.filename}") is finished:`;
    if (family.length > 1) {
        const lines = family.map((m) => `- #${m.id}${m.chequeNumber ? ` cheque ${m.chequeNumber}` : ''}${m.amount != null ? ` $${m.amount.toFixed(2)}` : ''}: ` +
            (m.transaction
                ? `attached to ${m.transaction}`
                : `${m.status.toLowerCase()}, not attached`));
        return (`${head} it held ${family.length} documents, now ${family.length} separate files:\n${lines.join('\n')}\n` +
            'Tell the caller exactly this, briefly — the number of files above, never another. The attached ones are ALREADY on the right transactions: never move them unless the caller says one is wrong. Only the ones not attached still need a transaction (use their ids above).');
    }
    if (row.status === 'MATCHED') {
        return `${head} it was read and attached to a transaction (get_attachment ${attachmentId} says which). Tell the caller now, briefly.`;
    }
    if (row.status === 'DOCUMENT') {
        return `${head} it was read as a document, not a payment, so it is kept but not attached. Tell the caller now, briefly.`;
    }
    return (`${head} ${row.status === 'FAILED' ? 'it could not be read' : 'it was read but not matched'}` +
        ` (${row.matchNote ?? row.error ?? 'no reason given'}). Tell the caller now, briefly, and offer to attach it to the right transaction.`);
}
function statementDoneNote(statementId, row) {
    const head = `[System note, not from the caller] The statement you re-read on this call (#${statementId}, "${row.filename}") is finished:`;
    const money = (n) => n == null ? 'not read' : `$${n.toFixed(2)}`;
    const balances = `opening ${money(row.openingBalance)}, closing ${money(row.closingBalance)}`;
    if (row.status === 'DONE' && row.verification === 'VERIFIED') {
        return `${head} it was read and matches the bank's own figures (${balances}) — its transactions are in the books. Tell the caller now, briefly.`;
    }
    if (row.status === 'DONE') {
        return (`${head} it was read and its transactions are in the books, but they could NOT be checked against the bank's figures (${balances}). ` +
            'Tell the caller now, briefly and exactly that — never say it matches or is fixed. If they read you a balance that is "not read" above, offer to read it again with that figure in the note.');
    }
    return (`${head} it still could not be read (${row.status}). The reason: ${row.error ?? 'unknown'}. ` +
        'Tell the caller now, briefly and plainly. Do not promise a review or a timeline you cannot see.');
}
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
    responseHadTool = false;
    responseSaid = '';
    promiseNudged = false;
    tools = Promise.resolve();
    toolsRunning = 0;
    closed = false;
    timer = null;
    ending = false;
    endMarkSent = false;
    watched = new Map();
    watchedFiles = new Map();
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
            case 'mark':
                if (this.ending && msg.mark?.name === END_MARK)
                    this.close();
                return;
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
        this.startedAt = Date.now();
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
                about: claims.about ?? null,
            });
        this.connectRealtime(model, instructions, thirdParty ? [voice_util_1.END_CALL_TOOL] : (0, assistant_tools_1.toolsFor)('VOICE'), this.opening(customerName, claims));
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
                : claims.purpose === 'REQUESTED'
                    ? 'We called them because they asked us to (what about is below); help them with it, then answer their questions.'
                    : 'We called them to deliver a scheduled message; after it, answer their questions.',
            `The call ends after ${this.settings.maxMinutes} minutes.`,
            `Speak ${(0, voice_util_1.languageName)(this.settings.language)} by default. If the caller asks you to ` +
                'speak another language, or clearly speaks whole sentences in one, switch to it and keep ' +
                'using it for the rest of the call, texts you send with send_text included. Never switch ' +
                'because of a single word or a short, unclear fragment.',
            'Phone lines are noisy: when what you heard is unclear, only a word or two, or sounds like ' +
                'noise, say nothing about its content — at most ask once, briefly, to repeat. Never answer a ' +
                'guess. When you have asked a question, wait for the answer; never fill a silence with more talk.',
            'Never promise what no tool did: no "staff / a specialist will review it", no "in a few business ' +
                'days", no "I\'ll let you know" — unless a tool result or a note on this call says it will happen.',
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
        }
        else if (has(voice_util_1.RT.responseCreated, type)) {
            if (this.ending) {
                this.sendOpenAi({ type: 'response.cancel' });
                return;
            }
            this.responding = true;
            this.requested = false;
            this.spoke = false;
            this.responseHadTool = false;
            this.responseSaid = '';
        }
        else if (has(voice_util_1.RT.responseDone, type)) {
            this.responding = false;
            if (this.ending)
                this.sendEndMark();
            this.recordUsage(this.model, 'realtime', ev.response?.usage);
            if (this.fillerWanted && this.toolsRunning > 0) {
                this.fillerWanted = false;
                this.createResponse({ instructions: FILLER, tool_choice: 'none' });
                return;
            }
            this.fillerWanted = false;
            this.answerToolsIfReady();
            this.keepPromise();
            this.flushNotes();
        }
        else if (has(voice_util_1.RT.userText, type)) {
            this.promiseNudged = false;
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
            if (said)
                this.responseSaid += ` ${said}`;
        }
        else if (has(voice_util_1.RT.toolCall, type)) {
            this.responseHadTool = true;
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
    endCall() {
        if (this.ending)
            return;
        this.ending = true;
        if (!this.responding)
            this.sendEndMark();
        setTimeout(() => this.close(), END_FALLBACK_MS).unref?.();
    }
    sendEndMark() {
        if (this.endMarkSent)
            return;
        this.endMarkSent = true;
        this.sendSignalWire({
            event: 'mark',
            streamSid: this.streamSid,
            mark: { name: END_MARK },
        });
    }
    keepPromise() {
        if (this.responseHadTool ||
            this.promiseNudged ||
            this.prospect ||
            this.ending ||
            this.toolsRunning > 0 ||
            this.toolOutputsPending ||
            this.watched.size > 0 ||
            this.watchedFiles.size > 0 ||
            !promisedAction(this.responseSaid)) {
            return;
        }
        this.promiseNudged = true;
        this.logger.log(`call ${this.callSid}: promised an action without a tool — reminding the model`);
        this.inject(exports.KEEP_PROMISE_NOTE);
    }
    answerToolsIfReady() {
        if (this.ending)
            return;
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
        if (name === voice_util_1.END_CALL_TOOL.name && this.claims?.purpose === 'THIRD_PARTY') {
            const ended = (0, voice_util_1.parseEndCall)(args);
            if (ended && this.callSid) {
                this.deps.calls.notePersonOutcome(this.callSid, ended);
            }
            this.logger.log(`call ${this.callSid}: end_call ${ended?.outcome ?? '(bad arguments)'}`);
            this.sendOpenAi({
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: callId,
                    output: 'The call is ending. Say nothing more.',
                },
            });
            this.endCall();
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
        if (name === 'retry_statement' && outcome.action?.ok) {
            this.watchStatement(scope, statementIdOf(args));
        }
        if ((name === 'reread_attachment' || name === 'retry_attachment') &&
            outcome.action?.ok) {
            this.watchAttachment(scope, idArg(args, 'attachmentId'));
        }
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
    watchStatement(scope, statementId) {
        if (!statementId || this.closed || this.watched.has(statementId))
            return;
        const started = Date.now();
        const tick = async () => {
            if (this.closed)
                return this.unwatch(statementId);
            const row = await this.deps.prisma.bankStatement.findFirst({
                where: {
                    id: statementId,
                    customerId: scope.customerId,
                    bookId: scope.bookId,
                    deletedAt: null,
                },
                select: {
                    status: true,
                    error: true,
                    filename: true,
                    verification: true,
                    openingBalance: true,
                    closingBalance: true,
                },
            });
            if (!row)
                return this.unwatch(statementId);
            if (row.status === 'PENDING' || row.status === 'PROCESSING') {
                if (Date.now() - started > WATCH_FOR_MS)
                    this.unwatch(statementId);
                return;
            }
            this.unwatch(statementId);
            this.inject(statementDoneNote(statementId, {
                ...row,
                openingBalance: row.openingBalance === null ? null : Number(row.openingBalance),
                closingBalance: row.closingBalance === null ? null : Number(row.closingBalance),
            }));
        };
        this.watched.set(statementId, setInterval(() => {
            void tick().catch((err) => {
                this.logger.warn(`call ${this.callSid}: statement #${statementId} watch failed: ${err instanceof Error ? err.message : String(err)}`);
                this.unwatch(statementId);
            });
        }, WATCH_EVERY_MS));
    }
    unwatch(statementId) {
        const t = this.watched.get(statementId);
        if (t)
            clearInterval(t);
        this.watched.delete(statementId);
    }
    async fileFamily(scope, attachmentId) {
        const rows = await this.deps.prisma.transactionAttachment.findMany({
            where: {
                customerId: scope.customerId,
                bookId: scope.bookId,
                deletedAt: null,
                OR: [
                    { id: attachmentId },
                    { sourceRef: { startsWith: `doc:${attachmentId}:` } },
                ],
            },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                status: true,
                extracted: true,
                transaction: { select: { description: true, amount: true } },
            },
        });
        return rows.map((r) => {
            const e = (r.extracted ?? {});
            const num = e.checkNumber ?? e.chequeNumber;
            const total = Number(e.total ?? e.amount);
            return {
                id: r.id,
                status: r.status,
                chequeNumber: typeof num === 'string' && num ? num : null,
                amount: Number.isFinite(total) && total ? total : null,
                transaction: r.transaction
                    ? `${r.transaction.description} ${Number(r.transaction.amount).toFixed(2)}`
                    : null,
            };
        });
    }
    watchAttachment(scope, attachmentId) {
        if (!attachmentId || this.closed || this.watchedFiles.has(attachmentId))
            return;
        const started = Date.now();
        const stop = () => {
            const t = this.watchedFiles.get(attachmentId);
            if (t)
                clearInterval(t);
            this.watchedFiles.delete(attachmentId);
        };
        const tick = async () => {
            if (this.closed)
                return stop();
            const row = await this.deps.prisma.transactionAttachment.findFirst({
                where: {
                    id: attachmentId,
                    customerId: scope.customerId,
                    bookId: scope.bookId,
                    deletedAt: null,
                },
                select: { status: true, error: true, matchNote: true, filename: true },
            });
            if (!row)
                return stop();
            if (row.status === 'PENDING' || row.status === 'PROCESSING') {
                if (Date.now() - started > WATCH_FOR_MS)
                    stop();
                return;
            }
            stop();
            this.inject(attachmentDoneNote(attachmentId, row, await this.fileFamily(scope, attachmentId)));
        };
        this.watchedFiles.set(attachmentId, setInterval(() => {
            void tick().catch((err) => {
                this.logger.warn(`call ${this.callSid}: attachment #${attachmentId} watch failed: ${err instanceof Error ? err.message : String(err)}`);
                stop();
            });
        }, WATCH_EVERY_MS));
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
        for (const id of [...this.watched.keys()])
            this.unwatch(id);
        for (const t of this.watchedFiles.values())
            clearInterval(t);
        this.watchedFiles.clear();
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
        if (this.claims.about && this.conversation) {
            await this.deps.assistant
                .copyCallToChat(this.claims.about, this.conversation.id, this.claims.sub, new Date(this.startedAt - 2000))
                .catch((err) => this.fail(err));
        }
        this.logger.log(`call ${this.callSid} ended`);
    }
}
exports.VoiceSession = VoiceSession;
//# sourceMappingURL=voice-session.js.map