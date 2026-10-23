"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AssistantTools_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantTools = exports.WRITE_TOOL_NAMES = exports.ASSISTANT_TOOLS = exports.READ_TOOLS = exports.NOT_UNDERSTOOD_WARNING = void 0;
exports.toolsFor = toolsFor;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const attachment_processor_service_1 = require("../bookkeeping/attachment-processor.service");
const attachments_service_1 = require("../bookkeeping/attachments.service");
const bookkeeping_service_1 = require("../bookkeeping/bookkeeping.service");
const customer_accounts_service_1 = require("../bookkeeping/customer-accounts.service");
const name_memory_service_1 = require("../bookkeeping/name-memory.service");
const reports_service_1 = require("../bookkeeping/reports.service");
const scope_1 = require("../bookkeeping/scope");
const splits_service_1 = require("../bookkeeping/splits.service");
const tax_service_1 = require("../bookkeeping/tax.service");
const file_links_1 = require("../bookkeeping/file-links");
const assistant_prompt_1 = require("./assistant-prompt");
const book_switch_1 = require("./book-switch");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const rules_service_1 = require("./rules.service");
const ai_schedules_store_1 = require("../schedules/ai-schedules.store");
const rules_util_1 = require("./rules.util");
const transaction_filter_util_1 = require("./transaction-filter.util");
const links_util_1 = require("./links.util");
const communications_history_service_1 = require("./communications-history.service");
const customer_outbox_service_1 = require("./customer-outbox.service");
const MAX_RESULT_CHARS = 12_000;
exports.NOT_UNDERSTOOD_WARNING = "Filed where you said, but I couldn't see why it matches — please double-check.";
const str = { type: 'string' };
const int = { type: 'integer' };
const num = { type: 'number' };
const day = { type: 'string', description: 'YYYY-MM-DD' };
const obj = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
exports.READ_TOOLS = [
    {
        name: 'list_statements',
        description: "This book's bank / card statements: account, period, status, row count.",
        parameters: obj({}),
    },
    {
        name: 'search_transactions',
        description: 'Find transactions (and splits) in this book. All filters optional. Returns the count and total of ALL matches plus up to `limit` rows (newest first). Use for questions like "transactions from March" or "how much at Costco".',
        parameters: obj({
            from: day,
            to: day,
            name: { type: 'string', description: 'payee name contains' },
            category: { type: 'string', description: 'category contains' },
            text: {
                type: 'string',
                description: 'name, description or item contains',
            },
            minAmount: num,
            maxAmount: num,
            direction: { type: 'string', enum: ['in', 'out'] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
        }),
    },
    {
        name: 'get_reports',
        description: 'Chart of accounts, income statement and balance sheet for a period (dates optional = everything).',
        parameters: obj({ from: day, to: day }),
    },
    {
        name: 'list_names',
        description: 'Every payee name with its category and row count (the Names tab).',
        parameters: obj({}),
    },
    {
        name: 'list_categories',
        description: 'Every category the customer may use: the chart plus their own.',
        parameters: obj({}),
    },
    {
        name: 'list_attachments',
        description: 'Receipts, cheques, voice notes and other files (letters, screenshots — status DOCUMENT) in this book, newest first.',
        parameters: obj({
            status: {
                type: 'string',
                enum: [
                    'PENDING',
                    'PROCESSING',
                    'MATCHED',
                    'UNMATCHED',
                    'FAILED',
                    'DOCUMENT',
                ],
            },
        }),
    },
    {
        name: 'get_attachment',
        description: 'One attachment: what was read off it, its status and why it matched or not.',
        parameters: obj({ attachmentId: int }, ['attachmentId']),
    },
    {
        name: 'find_match_candidates',
        description: "Search transactions an attachment could belong to, wider than the automatic matcher. Use the customer's hints (date range, amount, a word from the payee or description).",
        parameters: obj({ attachmentId: int, from: day, to: day, amount: num, text: str }, ['attachmentId']),
    },
    {
        name: 'list_rules',
        description: 'The rules learned for this book.',
        parameters: obj({}),
    },
    {
        name: 'get_link',
        description: 'A link the customer can open (no sign-in, works 7 days) to a file of this book: a statement PDF (statementId), an attachment (attachmentId), the financial report for a period (from/to), or the whole ledger (format pdf or xlsx). Use when they want to see, download or forward something.',
        parameters: obj({
            type: {
                type: 'string',
                enum: ['statement', 'attachment', 'report', 'ledger'],
            },
            statementId: int,
            attachmentId: int,
            from: day,
            to: day,
            format: { type: 'string', enum: ['pdf', 'xlsx'] },
        }, ['type']),
    },
    {
        name: 'list_schedules',
        description: 'The messages this book sends the customer on a schedule: the two built-ins (account status, financial report — set in the Schedules tab) and the ones made with create_schedule (id, title, task, when, channel, active, next run).',
        parameters: obj({}),
    },
    {
        name: 'search_communications',
        description: 'Look up what this customer and you said or sent on ANY channel — website chat, texts, WhatsApp, email, phone calls (transcripts) — in any of their books. Use when they refer to an earlier conversation (“the docs I told you about on the phone”, “what you emailed me last week”) and it is not in the RECENT ON THE CUSTOMER’S OTHER CHANNELS block. Each hit has its files (attachment ids) and linksSent (get_link arguments to make the same link again). channel VOICE also lists the calls.',
        parameters: obj({
            channel: {
                type: 'string',
                enum: ['BOT', 'SMS', 'WHATSAPP', 'EMAIL', 'VOICE'],
                description: 'BOT = website chat, VOICE = phone calls',
            },
            query: {
                type: 'string',
                description: 'Word(s) to find in the messages — short, e.g. "lease"',
            },
            from: day,
            to: day,
            limit: { type: 'integer', minimum: 1, maximum: 30 },
        }),
    },
];
const SWITCH_BOOK_TOOL = {
    name: 'switch_book',
    description: "Change which books this chat works on (the customer's personal books or one of their businesses), when the customer asks to switch. book = the number from the list or the business's name.",
    parameters: obj({ book: str }, ['book']),
};
const WRITE_TOOLS = [
    {
        name: 'attach_receipt',
        description: 'Attach a receipt / cheque / voice note to a transaction. understood=false when the customer told you where it goes but you cannot see why it matches.',
        parameters: obj({
            attachmentId: int,
            transactionId: int,
            understood: { type: 'boolean' },
            reason: str,
        }, ['attachmentId', 'transactionId', 'understood']),
    },
    {
        name: 'detach_receipt',
        description: 'Take an attachment off its transaction (back to "Not filed yet").',
        parameters: obj({ attachmentId: int }, ['attachmentId']),
    },
    {
        name: 'edit_transaction',
        description: 'Rename a transaction and/or change its category. always=true applies it to every row with this description, now and later; false only this row.',
        parameters: obj({
            transactionId: int,
            name: str,
            category: str,
            always: { type: 'boolean' },
        }, ['transactionId', 'always']),
    },
    {
        name: 'save_name_rule',
        description: "Set a payee name's category (and optionally rename it) everywhere — every row with that name, now and later.",
        parameters: obj({ name: str, newName: str, category: str }, ['name']),
    },
    {
        name: 'create_category',
        description: "Create a category of the customer's own.",
        parameters: obj({ name: str, type: { type: 'string', enum: [...customer_accounts_service_1.ACCOUNT_TYPES] } }, ['name', 'type']),
    },
    {
        name: 'save_splits',
        description: 'Split a transaction into parts (each with a category and a positive amount; the parts may not exceed the transaction). An empty list removes its splits.',
        parameters: obj({
            transactionId: int,
            splits: {
                type: 'array',
                items: obj({ name: str, category: str, amount: num }, [
                    'category',
                    'amount',
                ]),
            },
        }, ['transactionId', 'splits']),
    },
    {
        name: 'move_statement',
        description: 'File a statement under another bank / card account (by name).',
        parameters: obj({ statementId: int, accountName: str }, [
            'statementId',
            'accountName',
        ]),
    },
    {
        name: 'retry_attachment',
        description: 'Read a failed or unmatched attachment (receipt, cheque, voice note…) again. Not for a bank statement: use retry_statement.',
        parameters: obj({ attachmentId: int }, ['attachmentId']),
    },
    {
        name: 'retry_statement',
        description: 'Read a bank / card statement again from its PDF — one we could not read or that needs review (statementId from list_statements). Free; it takes a few minutes.',
        parameters: obj({ statementId: int }, ['statementId']),
    },
    {
        name: 'delete_attachment',
        description: 'Delete an attachment the customer does not want filed.',
        parameters: obj({ attachmentId: int }, ['attachmentId']),
    },
    {
        name: 'file_pdf_as_statement',
        description: 'A PDF attachment that is really a BANK STATEMENT: file it as a statement instead (the customer clicks Generate to read it).',
        parameters: obj({ attachmentId: int }, ['attachmentId']),
    },
    {
        name: 'create_schedule',
        description: 'The customer asks for something sent to them REPEATEDLY ("text me my financial report every day at 6am", "email me unmatched receipts every Friday") or ONCE LATER ("call me tomorrow at 3pm about my taxes", "remind me on the 30th"). Saves a schedule in this book; each time it fires, an assistant answers `task` with the read tools and sends the answer — with channel CALL it phones them and says it. Ask first when the time or day is missing. time = "HH:mm" 24 h in their time zone; ONCE needs date (YYYY-MM-DD, worked out from today). channel: SMS for "text me", EMAIL for "email me", CALL for "call me", omit for their preferred contact. For "call me now" use call_me instead. Confirm back what you saved in words (e.g. "every day at 6:00 AM by text").',
        parameters: obj({
            title: {
                type: 'string',
                description: 'Short name, e.g. "Daily financial report"',
            },
            task: {
                type: 'string',
                description: 'What to look up and send each time, as an instruction, e.g. "Summarise income, expenses and net for this month so far, with a link to the report"',
            },
            frequency: {
                type: 'string',
                enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'],
            },
            date: { type: 'string', description: 'ONCE only: YYYY-MM-DD' },
            weekday: {
                type: 'integer',
                minimum: 0,
                maximum: 6,
                description: 'WEEKLY only: 0 = Sunday … 6 = Saturday',
            },
            monthDay: {
                type: 'integer',
                minimum: 0,
                maximum: 28,
                description: 'MONTHLY only: 1–28, or 0 = the last day',
            },
            time: { type: 'string', description: 'HH:mm, 24 h' },
            channel: { type: 'string', enum: ['SMS', 'EMAIL', 'CALL'] },
        }, ['title', 'task', 'frequency', 'time']),
    },
    {
        name: 'update_schedule',
        description: 'Change a schedule made with create_schedule (id from list_schedules): any field, or active=false to pause / true to resume. channel PREFERRED = their preferred contact.',
        parameters: obj({
            scheduleId: int,
            title: str,
            task: str,
            frequency: {
                type: 'string',
                enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'],
            },
            date: { type: 'string', description: 'ONCE only: YYYY-MM-DD' },
            weekday: { type: 'integer', minimum: 0, maximum: 6 },
            monthDay: { type: 'integer', minimum: 0, maximum: 28 },
            time: { type: 'string', description: 'HH:mm, 24 h' },
            channel: {
                type: 'string',
                enum: ['SMS', 'EMAIL', 'CALL', 'PREFERRED'],
            },
            active: { type: 'boolean' },
        }, ['scheduleId']),
    },
    {
        name: 'delete_schedule',
        description: 'Stop and remove a schedule made with create_schedule (the built-ins are turned off in the Schedules tab, not here).',
        parameters: obj({ scheduleId: int }, ['scheduleId']),
    },
    {
        name: 'save_rule',
        description: "Remember a lesson so the AI gets it right next time. Shortest wording possible (max 15 words). scope 'customer' = about this customer's own habits, names or private details; 'global' = would help every customer (staff approve it first).",
        parameters: obj({
            text: str,
            scope: { type: 'string', enum: ['customer', 'global'] },
            topic: { type: 'string', enum: [...rules_util_1.RULE_TOPICS] },
        }, ['text', 'scope', 'topic']),
    },
];
const SEND_TEXT_TOOL = {
    name: 'send_text',
    description: 'Text the customer (the phone they are calling from) — a link from get_link, a list, or details too long to say. Tell them you sent it.',
    parameters: obj({ text: str }, ['text']),
};
const SEND_MESSAGE_TOOL = {
    name: 'send_message',
    description: 'Send the customer a message on a channel OTHER than this conversation — EMAIL (“email me the docs”), SMS (“text me the link”) or WHATSAPP — always to their own email / phone on the account. Put links from get_link in the text. To answer in this conversation, just reply instead. Tell them where you sent it; if it fails, say so and offer another channel.',
    parameters: obj({
        channel: { type: 'string', enum: ['EMAIL', 'SMS', 'WHATSAPP'] },
        text: str,
        subject: { type: 'string', description: 'EMAIL only: a short subject' },
    }, ['channel', 'text']),
};
const CALL_ME_TOOL = {
    name: 'call_me',
    description: 'Phone the customer NOW on their own number, when they ask you to call them ("call me", "can you call me about this"). The call is the same assistant by voice; about = what to talk about, in a sentence (it opens the call). For a call at a later time use create_schedule with channel CALL. Only ever the customer — never anyone else.',
    parameters: obj({
        about: {
            type: 'string',
            description: 'What they want to talk about, e.g. "the three receipts that did not match"',
        },
    }, ['about']),
};
const REPORT_ISSUE_TOOL = {
    name: 'report_ai_issue',
    description: 'The customer says the AI got something wrong (a file read wrong, a receipt attached to the wrong transaction or not attached, a wrong category or answer, something they said ignored). NOT for a new request or a change of mind. A specialist checks what happened and may fix how we work; follow what it returns.',
    parameters: obj({
        complaint: {
            type: 'string',
            description: "The customer's complaint in their own words",
        },
        whatWentWrong: {
            type: 'string',
            description: 'What you think the AI did wrong, as far as you can tell',
        },
        attachmentIds: { type: 'array', items: int },
        transactionIds: { type: 'array', items: int },
    }, ['complaint', 'whatWentWrong']),
};
exports.ASSISTANT_TOOLS = [
    ...exports.READ_TOOLS,
    ...WRITE_TOOLS,
    REPORT_ISSUE_TOOL,
];
exports.WRITE_TOOL_NAMES = new Set([
    ...WRITE_TOOLS.map((t) => t.name),
    REPORT_ISSUE_TOOL.name,
    SWITCH_BOOK_TOOL.name,
    SEND_TEXT_TOOL.name,
    SEND_MESSAGE_TOOL.name,
    CALL_ME_TOOL.name,
]);
function toolsFor(channel) {
    if (channel === 'BOT')
        return [...exports.ASSISTANT_TOOLS, SEND_MESSAGE_TOOL, CALL_ME_TOOL];
    if (channel === 'VOICE')
        return [
            ...exports.ASSISTANT_TOOLS,
            SWITCH_BOOK_TOOL,
            SEND_TEXT_TOOL,
            SEND_MESSAGE_TOOL,
        ];
    return [
        ...exports.ASSISTANT_TOOLS,
        SWITCH_BOOK_TOOL,
        SEND_MESSAGE_TOOL,
        CALL_ME_TOOL,
    ];
}
const SHOWN_ON_FAILURE = new Set([...exports.WRITE_TOOL_NAMES, 'get_link']);
const ALL_TOOL_NAMES = new Set([
    ...exports.ASSISTANT_TOOLS,
    SWITCH_BOOK_TOOL,
    SEND_TEXT_TOOL,
    SEND_MESSAGE_TOOL,
    CALL_ME_TOOL,
].map((t) => t.name));
const s = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
const n = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const id = (v) => {
    const x = n(v);
    if (x === null || !Number.isInteger(x) || x <= 0)
        throw new Error('a valid id is required');
    return x;
};
const scheduleInput = (a) => {
    const out = {};
    if (typeof a.title === 'string')
        out.title = a.title;
    if (typeof a.task === 'string')
        out.task = a.task;
    if (a.frequency === 'DAILY' ||
        a.frequency === 'WEEKLY' ||
        a.frequency === 'MONTHLY')
        out.frequency = a.frequency;
    if (typeof a.weekday === 'number')
        out.weekday = a.weekday;
    if (typeof a.monthDay === 'number')
        out.monthDay = a.monthDay;
    if (typeof a.time === 'string')
        out.time = a.time;
    if (typeof a.date === 'string')
        out.date = a.date;
    if (a.frequency === 'ONCE')
        out.frequency = 'ONCE';
    if (a.channel === 'SMS' || a.channel === 'EMAIL' || a.channel === 'CALL')
        out.channel = a.channel;
    if (a.channel === 'PREFERRED')
        out.channel = null;
    if (typeof a.active === 'boolean')
        out.active = a.active;
    return out;
};
const linkLabel = (ref) => {
    const v = (x, none) => typeof x === 'string' || typeof x === 'number' ? String(x) : none;
    const period = ref.from || ref.to ? ` ${v(ref.from, '…')} – ${v(ref.to, '…')}` : '';
    if (ref.type === 'statement')
        return `statement #${v(ref.statementId, '?')}`;
    if (ref.type === 'attachment')
        return `file #${v(ref.attachmentId, '?')}`;
    if (ref.type === 'report')
        return `the financial report${period}`;
    return `the ledger (${v(ref.format, 'pdf')})${period}`;
};
const json = (v) => {
    const text = JSON.stringify(v);
    return text.length > MAX_RESULT_CHARS
        ? `${text.slice(0, MAX_RESULT_CHARS)}… (cut — narrow the search)`
        : text;
};
let AssistantTools = AssistantTools_1 = class AssistantTools {
    prisma;
    bookkeeping;
    reports;
    tax;
    accounts;
    attachments;
    processor;
    names;
    splits;
    rules;
    links;
    messenger;
    aiSchedules;
    history;
    outbox;
    constructor(prisma, bookkeeping, reports, tax, accounts, attachments, processor, names, splits, rules, links, messenger, aiSchedules, history, outbox) {
        this.prisma = prisma;
        this.bookkeeping = bookkeeping;
        this.reports = reports;
        this.tax = tax;
        this.accounts = accounts;
        this.attachments = attachments;
        this.processor = processor;
        this.names = names;
        this.splits = splits;
        this.rules = rules;
        this.links = links;
        this.messenger = messenger;
        this.aiSchedules = aiSchedules;
        this.history = history;
        this.outbox = outbox;
    }
    logger = new common_1.Logger(AssistantTools_1.name);
    issueHandler = null;
    setIssueHandler(handler) {
        this.issueHandler = handler;
    }
    callHandler = null;
    setCallHandler(handler) {
        this.callHandler = handler;
    }
    schedulesStore() {
        if (!this.aiSchedules)
            throw new Error('schedules are not available');
        return this.aiSchedules;
    }
    async schedulesList(scope) {
        const builtIn = await this.prisma.bookSchedule.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { type: true, enabled: true, nextRunAt: true },
        });
        const own = await this.schedulesStore().list(scope);
        return {
            builtIn: builtIn.map((b) => ({
                type: b.type,
                on: b.enabled,
                nextRunAt: b.nextRunAt?.toISOString() ?? null,
            })),
            schedules: own.map((r) => ({
                id: r.id,
                title: r.title,
                task: r.task,
                when: this.schedulesStore().describe(r),
                channel: r.channel ?? 'preferred contact',
                active: r.active,
                nextRunAt: r.nextRunAt?.toISOString() ?? null,
            })),
        };
    }
    async run(name, rawArgs, ctx) {
        let args;
        try {
            args = (JSON.parse(rawArgs || '{}') ?? {});
        }
        catch {
            return { content: json({ error: 'arguments were not valid JSON' }) };
        }
        if (!ALL_TOOL_NAMES.has(name)) {
            return { content: json({ error: `unknown tool ${name}` }) };
        }
        try {
            return await this.exec(name, args, ctx);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`tool ${name} failed (conversation ${ctx.conversation?.id ?? '-'}): ${message}`);
            return {
                content: json({ error: message }),
                ...(SHOWN_ON_FAILURE.has(name) && {
                    action: {
                        tool: name,
                        ok: false,
                        summary: `Could not ${name.replace(/_/g, ' ')}: ${message}`,
                    },
                }),
            };
        }
    }
    async exec(name, a, ctx) {
        const { scope } = ctx;
        const done = (summary, data = { ok: true }) => ({
            content: json(data),
            action: { tool: name, ok: true, summary },
            ...(typeof a.attachmentId === 'number' && a.attachmentId > 0
                ? { attachmentId: a.attachmentId }
                : {}),
        });
        switch (name) {
            case 'list_statements': {
                const list = await this.bookkeeping.list(scope);
                return {
                    content: json(list.map((x) => ({
                        id: x.id,
                        label: x.label,
                        status: x.status,
                        account: x.accountName,
                        periodStart: x.periodStart,
                        periodEnd: x.periodEnd,
                        transactions: x.transactionCount,
                        error: x.error,
                    }))),
                };
            }
            case 'search_transactions': {
                const rows = (await this.bookkeeping.transactions(scope));
                return {
                    content: json((0, transaction_filter_util_1.filterTransactions)(rows, {
                        from: s(a.from),
                        to: s(a.to),
                        name: s(a.name),
                        category: s(a.category),
                        text: s(a.text),
                        minAmount: n(a.minAmount),
                        maxAmount: n(a.maxAmount),
                        direction: a.direction === 'in' || a.direction === 'out'
                            ? a.direction
                            : null,
                        limit: n(a.limit),
                    })),
                };
            }
            case 'get_reports':
                return {
                    content: json(await this.reports.reports(scope, s(a.from), s(a.to))),
                };
            case 'list_names':
                return { content: json(await this.tax.names(scope)) };
            case 'list_categories':
                return {
                    content: json((await this.accounts.list(scope)).map((c) => ({
                        name: c.name,
                        type: c.type,
                    }))),
                };
            case 'list_attachments': {
                const status = s(a.status);
                const list = (await this.attachments.list(scope))
                    .filter((x) => !status || x.status === status)
                    .slice(0, 60);
                return {
                    content: json(list.map((x) => ({
                        id: x.id,
                        kind: x.kind,
                        status: x.status,
                        filename: x.filename,
                        vendor: x.reading?.vendor ?? x.reading?.payee ?? null,
                        date: x.reading?.date ?? null,
                        total: x.total,
                        note: x.matchNote,
                        transaction: x.transaction
                            ? {
                                id: x.transaction.id,
                                name: x.transaction.name,
                                amount: x.transaction.amount,
                            }
                            : null,
                        received: x.createdAt,
                    }))),
                };
            }
            case 'get_attachment':
                return {
                    content: json(await this.attachments.get(scope, id(a.attachmentId))),
                };
            case 'find_match_candidates':
                return {
                    content: json(await this.processor.candidatesFor(scope, id(a.attachmentId), {
                        from: s(a.from),
                        to: s(a.to),
                        amount: n(a.amount),
                        text: s(a.text),
                    })),
                };
            case 'list_rules':
                return { content: json(await this.rules.listCustomerRules(scope)) };
            case 'get_link': {
                const type = s(a.type);
                if (type !== 'statement' &&
                    type !== 'attachment' &&
                    type !== 'report' &&
                    type !== 'ledger') {
                    throw new Error('type must be statement, attachment, report or ledger');
                }
                const url = await this.links.link(scope, {
                    kind: type,
                    id: type === 'statement'
                        ? id(a.statementId)
                        : type === 'attachment'
                            ? id(a.attachmentId)
                            : undefined,
                    from: s(a.from),
                    to: s(a.to),
                    format: a.format === 'xlsx' ? 'xlsx' : 'pdf',
                });
                const ref = { type };
                if (type === 'statement')
                    ref.statementId = id(a.statementId);
                if (type === 'attachment')
                    ref.attachmentId = id(a.attachmentId);
                if (s(a.from))
                    ref.from = s(a.from);
                if (s(a.to))
                    ref.to = s(a.to);
                if (type === 'ledger')
                    ref.format = a.format === 'xlsx' ? 'xlsx' : 'pdf';
                const shared = {
                    tool: 'get_link',
                    ok: true,
                    summary: `Shared a link to ${linkLabel(ref)}`,
                    ref,
                };
                if (ctx.links) {
                    return {
                        content: json({
                            link: (0, links_util_1.addLink)(ctx.links, url),
                            expiresInDays: 7,
                            note: 'Write this placeholder exactly where the link goes; it is replaced with the real link when your answer is sent. Never write a link yourself.',
                        }),
                        action: shared,
                        ...(type === 'attachment'
                            ? { attachmentId: id(a.attachmentId) }
                            : {}),
                    };
                }
                return {
                    content: json({ url, expiresInDays: 7 }),
                    action: shared,
                    ...(type === 'attachment'
                        ? { attachmentId: id(a.attachmentId) }
                        : {}),
                };
            }
            case 'switch_book':
                return this.switchBook(ctx, s(a.book));
            case 'report_ai_issue': {
                const ids = (v) => Array.isArray(v)
                    ? v.filter((x) => Number.isInteger(x) && x > 0)
                    : [];
                const report = {
                    complaint: s(a.complaint) ?? '',
                    whatWentWrong: s(a.whatWentWrong) ?? '',
                    attachmentIds: ids(a.attachmentIds),
                    transactionIds: ids(a.transactionIds),
                };
                const outcome = this.issueHandler
                    ? await this.issueHandler(ctx, report)
                    : {
                        instructions: 'Nobody can check this right now. Apologise, fix what the customer asked with your tools, and continue as you normally would.',
                        summary: 'Problem noted',
                        ok: true,
                    };
                return {
                    content: json({ result: outcome.instructions }),
                    action: {
                        tool: 'report_ai_issue',
                        ok: outcome.ok,
                        summary: outcome.summary,
                    },
                };
            }
            case 'send_text': {
                const raw = s(a.text);
                const body = raw ? (0, links_util_1.fillLinks)(raw, ctx.links) : raw;
                const peer = ctx.conversation?.peer;
                if (!body)
                    throw new Error('nothing to text');
                if (!peer || !this.messenger)
                    throw new Error('texting is not available');
                const outcome = await this.messenger.send({
                    channel: 'SMS',
                    to: peer,
                    body,
                });
                if (outcome !== 'sent')
                    throw new Error(`the text was not sent (${outcome})`);
                return done('Texted the customer', { ok: true });
            }
            case 'send_message': {
                const channel = a.channel;
                if (channel !== 'EMAIL' && channel !== 'SMS' && channel !== 'WHATSAPP')
                    throw new Error('channel must be EMAIL, SMS or WHATSAPP');
                const raw = s(a.text);
                if (!raw)
                    throw new Error('nothing to send');
                if (!this.outbox)
                    throw new Error('sending is not available');
                const sent = await this.outbox.send(scope, channel, (0, links_util_1.fillLinks)(raw, ctx.links), s(a.subject));
                if (!sent.ok)
                    throw new Error(sent.error);
                const how = channel === 'EMAIL'
                    ? `Emailed ${sent.to}`
                    : channel === 'SMS'
                        ? 'Texted the customer'
                        : 'WhatsApped the customer';
                return done(how, { ok: true, sentTo: sent.to });
            }
            case 'call_me': {
                const about = s(a.about);
                if (!about)
                    throw new Error('say what the call is about');
                if (!this.callHandler)
                    throw new Error('phone calls are not available');
                const placed = await this.callHandler(ctx, about.slice(0, 500));
                if (!placed.ok)
                    throw new Error(placed.error);
                return done(placed.summary, {
                    ok: true,
                    note: 'Their phone rings in a few seconds. Tell them to pick up — keep this reply short.',
                });
            }
            case 'search_communications': {
                if (!this.history)
                    throw new Error('history is not available');
                return {
                    content: json(await this.history.search(scope.customerId, {
                        channel: s(a.channel),
                        query: s(a.query),
                        from: s(a.from),
                        to: s(a.to),
                        limit: n(a.limit),
                    })),
                };
            }
            case 'attach_receipt': {
                const view = await this.attachments.setTransaction(scope, id(a.attachmentId), id(a.transactionId));
                const understood = a.understood !== false;
                const t = view.transaction;
                const out = done(`Attached ${view.filename} to ${t?.name ?? t?.description ?? `transaction ${id(a.transactionId)}`}${t ? ` ($${Math.abs(t.amount).toFixed(2)})` : ''}`);
                return understood ? out : { ...out, warning: exports.NOT_UNDERSTOOD_WARNING };
            }
            case 'detach_receipt': {
                const view = await this.attachments.setTransaction(scope, id(a.attachmentId), null);
                return done(`Took ${view.filename} off its transaction`);
            }
            case 'edit_transaction': {
                const values = await this.accounts.editValues(scope, {
                    name: s(a.name),
                    category: s(a.category),
                });
                const always = a.always === true;
                await this.names.editTransaction(scope, id(a.transactionId), {
                    ...values,
                    scope: always ? 'ALWAYS' : 'ONCE',
                });
                const what = [
                    values.name && `renamed to ${values.name}`,
                    values.category && `filed under ${values.category}`,
                ]
                    .filter(Boolean)
                    .join(' and ');
                return done(`Transaction ${id(a.transactionId)} ${what}${always ? ' (every row like it)' : ''}`);
            }
            case 'save_name_rule': {
                const from = s(a.name);
                if (!from)
                    throw new Error('which name?');
                const values = await this.accounts.editValues(scope, {
                    name: s(a.newName) ?? from,
                    category: s(a.category),
                });
                await this.names.saveRule(scope, {
                    matchType: 'NAME',
                    matchKey: from,
                    name: values.name,
                    category: values.category,
                    scope: 'ALWAYS',
                });
                return done(`${from}${values.name && values.name !== from ? ` → ${values.name}` : ''}${values.category ? ` filed under ${values.category}` : ''} everywhere`);
            }
            case 'create_category': {
                const type = s(a.type);
                if (!type || !customer_accounts_service_1.ACCOUNT_TYPES.includes(type))
                    throw new Error('choose the kind of account');
                const created = await this.accounts.create(scope, {
                    name: s(a.name) ?? '',
                    type,
                });
                return done(`Created the category ${created.name}`);
            }
            case 'save_splits': {
                const list = Array.isArray(a.splits) ? a.splits : [];
                await this.splits.save(scope, id(a.transactionId), list.map((x) => ({
                    name: s(x.name),
                    category: s(x.category) ?? '',
                    amount: n(x.amount) ?? 0,
                })));
                return done(list.length
                    ? `Split transaction ${id(a.transactionId)} into ${list.length} part${list.length === 1 ? '' : 's'}`
                    : `Removed the splits of transaction ${id(a.transactionId)}`);
            }
            case 'move_statement': {
                const view = await this.bookkeeping.moveStatement(scope, id(a.statementId), s(a.accountName) ?? '');
                return done(`Moved ${view.label} to ${view.accountName}`);
            }
            case 'retry_attachment': {
                const view = await this.attachments.retry(scope, id(a.attachmentId));
                return done(`Reading ${view.filename} again`);
            }
            case 'retry_statement': {
                const view = await this.bookkeeping.retry(scope, id(a.statementId));
                return done(`Reading ${view.label} again`);
            }
            case 'delete_attachment': {
                const view = await this.attachments.get(scope, id(a.attachmentId));
                await this.attachments.remove(scope, view.id);
                return done(`Deleted ${view.filename}`);
            }
            case 'file_pdf_as_statement':
                return done(await this.fileAsStatement(scope, id(a.attachmentId)));
            case 'list_schedules':
                return { content: json(await this.schedulesList(scope)) };
            case 'create_schedule': {
                const row = await this.schedulesStore().create(scope, scheduleInput(a), { createdBy: 'AI', conversationId: ctx.conversation?.id ?? null });
                const when = this.schedulesStore().describe(row);
                return done(`Scheduled "${row.title}" — ${when}`, {
                    ok: true,
                    id: row.id,
                    when,
                    channel: row.channel ?? 'preferred contact',
                    nextRunAt: row.nextRunAt?.toISOString() ?? null,
                });
            }
            case 'update_schedule': {
                const row = await this.schedulesStore().update(scope, id(a.scheduleId), scheduleInput(a));
                const when = this.schedulesStore().describe(row);
                return done(`Updated "${row.title}" — ${row.active ? when : 'paused'}`, {
                    ok: true,
                    id: row.id,
                    when,
                    active: row.active,
                });
            }
            case 'delete_schedule': {
                const row = await this.schedulesStore().remove(scope, id(a.scheduleId));
                return done(`Removed the schedule "${row.title}"`);
            }
            case 'save_rule': {
                const text = s(a.text);
                if (!text)
                    throw new Error('the rule needs words');
                const global = a.scope === 'global';
                const saved = global
                    ? await this.rules.proposeGlobalRule(text, a.topic, scope.customerId, ctx.messageId)
                    : await this.rules.saveCustomerRule(scope, text, a.topic, ctx.messageId);
                return done(!saved
                    ? `Already knew: "${text}"`
                    : global
                        ? `Suggested to the CYG team: "${text}"`
                        : `Learned for next time: "${text}"`);
            }
        }
        return { content: json({ error: `unknown tool ${name}` }) };
    }
    async switchBook(ctx, book) {
        const conversation = ctx.conversation;
        if (!conversation || conversation.channel === 'BOT' || !conversation.peer) {
            throw new Error('books are switched on the website with the book picker');
        }
        const options = await (0, book_switch_1.bookOptions)(this.prisma, conversation.customerId);
        const found = (0, assistant_prompt_1.bookCandidates)(book, options);
        if (found.length !== 1) {
            return {
                content: json({
                    error: found.length
                        ? (0, assistant_prompt_1.whichBookQuestion)(found, options)
                        : `No book called "${book ?? ''}". The books are: ${options.map((o, i) => `${i + 1} ${o.name}`).join(', ')}`,
                }),
            };
        }
        const choice = found[0];
        const updated = await (0, book_switch_1.chooseBook)(this.prisma, conversation, choice);
        const { moved, reread } = await (0, book_switch_1.moveRecentFiles)(this.prisma, updated, conversation.peer, choice.companyId);
        if (reread)
            this.processor.processSoon();
        return {
            content: json({ ok: true, book: choice.name, filesMoved: moved }),
            action: {
                tool: 'switch_book',
                ok: true,
                summary: `This chat now works on ${choice.name}${moved ? ` (moved ${moved} file${moved === 1 ? '' : 's'} there)` : ''}`,
            },
        };
    }
    async fileAsStatement(scope, attachmentId) {
        const a = await this.prisma.transactionAttachment.findFirst({
            where: { id: attachmentId, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!a)
            throw new Error('attachment not found');
        if (a.mimeType !== 'application/pdf')
            throw new Error('only a PDF can be a statement');
        if (a.status === client_1.AttachmentStatus.PROCESSING)
            throw new Error('it is being read right now');
        await this.prisma.$transaction([
            this.prisma.bankStatement.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    filename: a.filename.slice(0, 191),
                    storageKey: a.storageKey,
                    sizeBytes: a.size,
                    source: a.source === 'STATEMENT' ? 'UPLOAD' : a.source,
                    status: client_1.StatementStatus.UPLOADED,
                },
            }),
            this.prisma.transactionAttachment.update({
                where: { id: a.id },
                data: { deletedAt: new Date() },
            }),
        ]);
        return `Filed ${a.filename} as a bank statement — click Generate on the Statements tab to read it`;
    }
};
exports.AssistantTools = AssistantTools;
exports.AssistantTools = AssistantTools = AssistantTools_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(12, (0, common_1.Optional)()),
    __param(13, (0, common_1.Optional)()),
    __param(14, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        bookkeeping_service_1.BookkeepingService,
        reports_service_1.ReportsService,
        tax_service_1.TaxService,
        customer_accounts_service_1.CustomerAccountsService,
        attachments_service_1.AttachmentsService,
        attachment_processor_service_1.AttachmentProcessorService,
        name_memory_service_1.NameMemoryService,
        splits_service_1.SplitsService,
        rules_service_1.RulesService,
        file_links_1.FileLinkService,
        customer_messenger_service_1.CustomerMessenger,
        ai_schedules_store_1.AiSchedulesStore,
        communications_history_service_1.CommunicationsHistory,
        customer_outbox_service_1.CustomerOutbox])
], AssistantTools);
//# sourceMappingURL=assistant-tools.js.map