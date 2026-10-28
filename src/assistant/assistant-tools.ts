import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AttachmentStatus,
  StatementStatus,
  type AiConversation,
} from '@prisma/client';
import type { ToolDefinition } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentProcessorService } from '../bookkeeping/attachment-processor.service';
import { AttachmentsService } from '../bookkeeping/attachments.service';
import { BookkeepingService } from '../bookkeeping/bookkeeping.service';
import {
  ACCOUNT_TYPES,
  CustomerAccountsService,
} from '../bookkeeping/customer-accounts.service';
import type { AccountType } from '../bookkeeping/chart-of-accounts';
import { NameMemoryService } from '../bookkeeping/name-memory.service';
import { ReportsService } from '../bookkeeping/reports.service';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { SplitsService } from '../bookkeeping/splits.service';
import { TaxService } from '../bookkeeping/tax.service';
import { FileLinkService } from '../bookkeeping/file-links';
import {
  bookCandidates,
  whichBookQuestion,
  type Channel,
} from './assistant-prompt';
import { bookOptions, chooseBook, moveRecentFiles } from './book-switch';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { RulesService } from './rules.service';
import {
  AiSchedulesStore,
  type AiScheduleInput,
} from '../schedules/ai-schedules.store';
import { RULE_TOPICS } from './rules.util';
import { filterTransactions, type LedgerRow } from './transaction-filter.util';
import { listStatements } from './statement-list.util';
import { addLink, fillLinks, type LinkBook } from './links.util';
import { CommunicationsHistory } from './communications-history.service';
import { CustomerOutbox, type OutboxChannel } from './customer-outbox.service';
import { AiContactsService } from '../ai-contacts/ai-contacts.service';
import { toE164 } from '../customer-auth/phone-number.util';
import { saveFeatureRequest } from '../feature-requests/feature-requests.store';

/** step12c: texts the AI may send to other people per customer per day. */
function textsToOthersPerDay(): number {
  const n = Number(process.env.AI_TEXTS_TO_OTHERS_PER_DAY);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

/** One thing the agent did, shown under its answer and kept in `AiMessage.actions`. */
export interface AgentAction {
  tool: string;
  ok: boolean;
  summary: string;
  /** step12b: get_link's arguments, so a later answer on any channel can make it again. */
  ref?: Record<string, unknown>;
}

/** What running one tool gave: the JSON for the model, and (writes only) the action. */
export interface ToolOutcome {
  content: string;
  action?: AgentAction;
  /** The agent did what the customer asked without understanding why (step11). */
  warning?: string;
  /** step11b: the attachment this tool changed — linked to the answer (ACTION). */
  attachmentId?: number;
}

/** step12: what `report_ai_issue` hands the strong AI. */
export interface IssueReport {
  complaint: string;
  whatWentWrong: string;
  attachmentIds: number[];
  transactionIds: number[];
}

/** step12: the strong AI's answer, as this agent's tool result and action. */
export interface IssueOutcome {
  /** Told to the regular agent: how to go on. */
  instructions: string;
  /** Shown under the answer ("AI did:"). */
  summary: string;
  ok: boolean;
}

export type IssueHandler = (
  ctx: ToolContext,
  report: IssueReport,
) => Promise<IssueOutcome>;

/** step12b: places a "call me now" call (`VoiceCallsService`, which depends on this class). */
export type CallHandler = (
  ctx: ToolContext,
  about: string,
) => Promise<{ ok: true; summary: string } | { ok: false; error: string }>;

/** step12c: the person a call_person / text_person reaches. */
export interface PersonTarget {
  /** E.164. */
  phone: string;
  contactId: number | null;
  /** The contact's name, else the one the customer gave, else null. */
  name: string | null;
}

/** step12c: places a call to someone else for the customer (`VoiceCallsService`). */
export type PersonCallHandler = (
  ctx: ToolContext,
  person: PersonTarget,
  message: string,
) => Promise<{ ok: true; summary: string } | { ok: false; error: string }>;

export interface ToolContext {
  scope: BookScope;
  /** The customer's message this answer is for — the source of any rule it saves. */
  messageId: number | null;
  /** step11b: the conversation being answered (switch_book changes its book). */
  conversation?: AiConversation;
  /**
   * step12: the links `get_link` issued in this answer (or phone call). When present, the
   * model gets a `[[link:N]]` placeholder instead of the URL and `fillLinks` swaps it back —
   * the model re-typing a 300-character token broke the link (links.util.ts).
   */
  links?: LinkBook;
}

/** The longest tool result handed back to the model. */
const MAX_RESULT_CHARS = 12_000;

export const NOT_UNDERSTOOD_WARNING =
  "Filed where you said, but I couldn't see why it matches — please double-check.";

const str = { type: 'string' };
const int = { type: 'integer' };
const num = { type: 'number' };
const day = { type: 'string', description: 'YYYY-MM-DD' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** READ tools: never change anything (step12: the strong AI investigates with them too). */
export const READ_TOOLS: ToolDefinition[] = [
  {
    name: 'list_statements',
    description:
      'This book\'s bank / card statements: first ONE line per account (every account, always), then the statements (id, account, period, status, rows), newest period first. Filter by account (words of its name, e.g. "american express 1004"), period or status — never conclude a statement is missing from a cut list; filter by its account instead.',
    parameters: obj({
      account: {
        type: 'string',
        description: 'account name contains these words',
      },
      from: day,
      to: day,
      status: {
        type: 'string',
        enum: [
          'UPLOADED',
          'PENDING',
          'PROCESSING',
          'DONE',
          'NEEDS_REVIEW',
          'FAILED',
        ],
      },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }),
  },
  {
    name: 'search_transactions',
    description:
      'Find transactions (and splits) in this book. All filters optional. Returns the count and total of ALL matches plus up to `limit` rows (newest first). Use for questions like "transactions from March" or "how much at Costco".',
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
    description:
      'Chart of accounts, income statement and balance sheet for a period (dates optional = everything).',
    parameters: obj({ from: day, to: day }),
  },
  {
    name: 'list_names',
    description:
      'Every payee name with its category and row count (the Names tab).',
    parameters: obj({}),
  },
  {
    name: 'list_categories',
    description:
      'Every category the customer may use: the chart plus their own.',
    parameters: obj({}),
  },
  {
    name: 'list_attachments',
    description:
      'Receipts, cheques, voice notes and other files (letters, screenshots — status DOCUMENT) in this book, newest first.',
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
    description:
      'One attachment: what was read off it, its status and why it matched or not.',
    parameters: obj({ attachmentId: int }, ['attachmentId']),
  },
  {
    name: 'find_match_candidates',
    description:
      "Search transactions an attachment could belong to, wider than the automatic matcher. Use the customer's hints (date range, amount, a word from the payee or description).",
    parameters: obj(
      { attachmentId: int, from: day, to: day, amount: num, text: str },
      ['attachmentId'],
    ),
  },
  {
    name: 'list_rules',
    description: 'The rules learned for this book.',
    parameters: obj({}),
  },
  {
    name: 'get_link',
    description:
      'A link the customer can open (no sign-in, works 7 days) to a file of this book: a statement PDF (statementId), an attachment (attachmentId), the financial report for a period (from/to), or the whole ledger (format pdf or xlsx). Use when they want to see, download or forward something.',
    parameters: obj(
      {
        type: {
          type: 'string',
          enum: ['statement', 'attachment', 'report', 'ledger'],
        },
        statementId: int,
        attachmentId: int,
        from: day,
        to: day,
        format: { type: 'string', enum: ['pdf', 'xlsx'] },
      },
      ['type'],
    ),
  },
  {
    name: 'list_schedules',
    description:
      'The messages this book sends the customer on a schedule: the two built-ins (account status, financial report — set in the Schedules tab) and the ones made with create_schedule (id, title, task, when, channel, active, next run).',
    parameters: obj({}),
  },
  {
    name: 'search_communications',
    description:
      'Look up what this customer and you said or sent on ANY channel — website chat, texts, WhatsApp, email, phone calls (transcripts) — in any of their books. Use when they refer to an earlier conversation (“the docs I told you about on the phone”, “what you emailed me last week”) and it is not in the RECENT ON THE CUSTOMER’S OTHER CHANNELS block. Each hit has its files (attachment ids) and linksSent (get_link arguments to make the same link again). channel VOICE also lists the calls.',
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

/**
 * step11b: on a text / WhatsApp / email thread the customer may say "switch to ABC" in any
 * words; this tool is how the assistant honours a phrasing the code did not recognise.
 */
const SWITCH_BOOK_TOOL: ToolDefinition = {
  name: 'switch_book',
  description:
    "Change which books this chat works on (the customer's personal books or one of their businesses), when the customer asks to switch. book = the number from the list or the business's name.",
  parameters: obj({ book: str }, ['book']),
};

/** WRITE tools: applied at once and listed under the answer. */
const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'attach_receipt',
    description:
      'Attach a receipt / cheque / voice note to a transaction. understood=false when the customer told you where it goes but you cannot see why it matches.',
    parameters: obj(
      {
        attachmentId: int,
        transactionId: int,
        understood: { type: 'boolean' },
        reason: str,
      },
      ['attachmentId', 'transactionId', 'understood'],
    ),
  },
  {
    name: 'detach_receipt',
    description:
      'Take an attachment off its transaction (back to "Not filed yet").',
    parameters: obj({ attachmentId: int }, ['attachmentId']),
  },
  {
    name: 'edit_transaction',
    description:
      'Rename a transaction and/or change its category. always=true applies it to every row with this description, now and later; false only this row.',
    parameters: obj(
      {
        transactionId: int,
        name: str,
        category: str,
        always: { type: 'boolean' },
      },
      ['transactionId', 'always'],
    ),
  },
  {
    name: 'save_name_rule',
    description:
      "Set a payee name's category (and optionally rename it) everywhere — every row with that name, now and later.",
    parameters: obj({ name: str, newName: str, category: str }, ['name']),
  },
  {
    name: 'create_category',
    description: "Create a category of the customer's own.",
    parameters: obj(
      { name: str, type: { type: 'string', enum: [...ACCOUNT_TYPES] } },
      ['name', 'type'],
    ),
  },
  {
    name: 'save_splits',
    description:
      'Split a transaction into parts (each with a category and a positive amount; the parts may not exceed the transaction). An empty list removes its splits.',
    parameters: obj(
      {
        transactionId: int,
        splits: {
          type: 'array',
          items: obj({ name: str, category: str, amount: num }, [
            'category',
            'amount',
          ]),
        },
      },
      ['transactionId', 'splits'],
    ),
  },
  {
    name: 'move_statement',
    description:
      'File a statement under another bank / card account (by name).',
    parameters: obj({ statementId: int, accountName: str }, [
      'statementId',
      'accountName',
    ]),
  },
  {
    name: 'retry_attachment',
    description:
      'Read a failed or unmatched attachment (receipt, cheque, voice note…) again. Not for a bank statement: use retry_statement.',
    parameters: obj({ attachmentId: int }, ['attachmentId']),
  },
  {
    name: 'retry_statement',
    description:
      'Read a bank / card statement again from its PDF — one we could not read or that needs review (statementId from list_statements). Free; it takes a few minutes.',
    parameters: obj({ statementId: int }, ['statementId']),
  },
  {
    name: 'delete_attachment',
    description: 'Delete an attachment the customer does not want filed.',
    parameters: obj({ attachmentId: int }, ['attachmentId']),
  },
  {
    name: 'file_pdf_as_statement',
    description:
      'A PDF attachment that is really a BANK STATEMENT: file it as a statement instead (the customer clicks Generate to read it).',
    parameters: obj({ attachmentId: int }, ['attachmentId']),
  },
  {
    name: 'create_schedule',
    description:
      'The customer asks for something sent to them REPEATEDLY ("text me my financial report every day at 6am", "email me unmatched receipts every Friday") or ONCE LATER ("call me tomorrow at 3pm about my taxes", "remind me on the 30th"). Saves a schedule in this book; each time it fires, an assistant answers `task` with the read tools and sends the answer — with channel CALL it phones them and says it. Ask first when the time or day is missing. time = "HH:mm" 24 h in their time zone; ONCE needs date (YYYY-MM-DD, worked out from today). channel: SMS for "text me", EMAIL for "email me", CALL for "call me", omit for their preferred contact. For "call me now" use call_me instead. Confirm back what you saved in words (e.g. "every day at 6:00 AM by text").',
    parameters: obj(
      {
        title: {
          type: 'string',
          description: 'Short name, e.g. "Daily financial report"',
        },
        task: {
          type: 'string',
          description:
            'What to look up and send each time, as an instruction, e.g. "Summarise income, expenses and net for this month so far, with a link to the report"',
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
      },
      ['title', 'task', 'frequency', 'time'],
    ),
  },
  {
    name: 'update_schedule',
    description:
      'Change a schedule made with create_schedule (id from list_schedules): any field, or active=false to pause / true to resume. channel PREFERRED = their preferred contact.',
    parameters: obj(
      {
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
      },
      ['scheduleId'],
    ),
  },
  {
    name: 'delete_schedule',
    description:
      'Stop and remove a schedule made with create_schedule (the built-ins are turned off in the Schedules tab, not here).',
    parameters: obj({ scheduleId: int }, ['scheduleId']),
  },
  {
    name: 'save_rule',
    description:
      "Remember a lesson so the AI gets it right next time. Shortest wording possible (max 15 words). scope 'customer' = about this customer's own habits, names or private details; 'global' = would help every customer (staff approve it first).",
    parameters: obj(
      {
        text: str,
        scope: { type: 'string', enum: ['customer', 'global'] },
        topic: { type: 'string', enum: [...RULE_TOPICS] },
      },
      ['text', 'scope', 'topic'],
    ),
  },
];

/**
 * step12: on a phone call the AI cannot show a link or a list — it texts them instead, to
 * the number on the call.
 */
const SEND_TEXT_TOOL: ToolDefinition = {
  name: 'send_text',
  description:
    'Text the customer (the phone they are calling from) — a link from get_link, a list, or details too long to say. Tell them you sent it.',
  parameters: obj({ text: str }, ['text']),
};

/**
 * step12b: send something to the customer on another channel than this one ("email me
 * that", "text me the link") — always to their OWN phone / email (`CustomerOutbox`).
 */
const SEND_MESSAGE_TOOL: ToolDefinition = {
  name: 'send_message',
  description:
    'Send the customer a message on a channel OTHER than this conversation — EMAIL (“email me the docs”), SMS (“text me the link”) or WHATSAPP — always to their own email / phone on the account. Put links from get_link in the text. To answer in this conversation, just reply instead. Tell them where you sent it; if it fails, say so and offer another channel.',
  parameters: obj(
    {
      channel: { type: 'string', enum: ['EMAIL', 'SMS', 'WHATSAPP'] },
      text: str,
      subject: { type: 'string', description: 'EMAIL only: a short subject' },
    },
    ['channel', 'text'],
  ),
};

/** step12b: "call me" — the AI phones the customer's own number now (`CallHandler`). */
const CALL_ME_TOOL: ToolDefinition = {
  name: 'call_me',
  description:
    'Phone the customer NOW on their own number, when they ask you to call them ("call me", "can you call me about this"). The call is the same assistant by voice; about = what to talk about, in a sentence (it opens the call). For a call at a later time use create_schedule with channel CALL. Only ever the customer — never anyone else.',
  parameters: obj(
    {
      about: {
        type: 'string',
        description:
          'What they want to talk about, e.g. "the three receipts that did not match"',
      },
    },
    ['about'],
  ),
};

/** step12c: the people the AI called / texted for the customer, and saved. */
const LIST_CONTACTS_TOOL: ToolDefinition = {
  name: 'list_contacts',
  description:
    'The customer\'s saved contacts (people you call or text for them) — id, name, phone, email. Use it to find who "call John" means.',
  parameters: obj({}),
};

const SAVE_CONTACT_TOOL: ToolDefinition = {
  name: 'save_contact',
  description:
    'Save (or rename / fill in) a contact of the customer — someone you call or text for them. Only when the customer gave the name and agreed to save it. A contact with the same phone is updated.',
  parameters: obj({ name: str, phone: str, email: str, note: str }, ['name']),
};

/** step12c: an account opened by text has no name yet — the AI asks and saves it. */
const UPDATE_MY_PROFILE_TOOL: ToolDefinition = {
  name: 'update_my_profile',
  description:
    'Save the customer\'s own name on their account, when they tell you it ("I\'m Sarah Cohen"), and/or turn their bank transaction alerts (a message with each new bank transaction and its category) off or on ("stop texting me every transaction" → transactionAlerts false). Never their email or phone — they change those on the Account page.',
  parameters: obj({ name: str, transactionAlerts: { type: 'boolean' } }),
};

const PERSON = {
  contactId: {
    type: 'integer',
    description: 'A saved contact (list_contacts)',
  },
  phone: {
    type: 'string',
    description: 'The number to reach, when it is not a saved contact',
  },
  name: {
    type: 'string',
    description: 'Their name, if the customer said it',
  },
};

/**
 * step12c (user's request: "allow calling other people so customer can say call 1222… and
 * tell him this"): text / call SOMEONE ELSE for the customer.
 */
const TEXT_PERSON_TOOL: ToolDefinition = {
  name: 'text_person',
  description:
    'Text someone OTHER than the customer for them ("text John that I\'m running late"). Give contactId, or phone (+ name). The text says it is from the customer via CYG Finance. Before sending, repeat who and what back to the customer and get a yes. If the person is not a saved contact, ask their name and offer to save them (save_contact) — then their reply reaches the customer. Never put the customer\'s financial details in it unless they asked for exactly that.',
  parameters: obj({ ...PERSON, message: str }, ['message']),
};

const CALL_PERSON_TOOL: ToolDefinition = {
  name: 'call_person',
  description:
    'Phone someone OTHER than the customer for them and pass on a message ("call 514 555 1234 and tell him the meeting moved to 3"). Give contactId, or phone (+ name). You (the same assistant, by voice) say you are calling for the customer, give the message and note any reply; the customer is told how it went. Before calling, repeat who and what back and get a yes. If the person is not a saved contact, ask their name and offer to save them (save_contact). For calling the customer themselves use call_me.',
  parameters: obj({ ...PERSON, message: str }, ['message']),
};

/**
 * step12: the customer says WE got something wrong — the conversation goes to the strong AI
 * (`StrongAiService`), which may fix our instructions; its answer tells this agent how to go on.
 */
const REPORT_ISSUE_TOOL: ToolDefinition = {
  name: 'report_ai_issue',
  description:
    'The customer says the AI got something wrong (a file read wrong, a receipt attached to the wrong transaction or not attached, a wrong category or answer, something they said ignored). NOT for a new request or a change of mind. A specialist checks what happened and may fix how we work; follow what it returns.',
  parameters: obj(
    {
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
    },
    ['complaint', 'whatWentWrong'],
  ),
};

/**
 * step12e: the customer asks for something the app cannot do yet — logged as a
 * `FeatureRequest` that staff see in the internal app and the customer under "My requests".
 */
const REQUEST_FEATURE_TOOL: ToolDefinition = {
  name: 'request_feature',
  description:
    'The customer asks for something none of your tools can do and the app does not offer yet. Logs it for the team; the customer can follow it under "My requests". NOT for a mistake we made (report_ai_issue) or something you or the website can already do.',
  parameters: obj(
    {
      request: {
        type: 'string',
        description: 'What the customer asked for, in their own words',
      },
      summary: {
        type: 'string',
        description: 'A short title for it (under 12 words)',
      },
    },
    ['request', 'summary'],
  ),
};

/** step12c: contacts, the customer's own name, and reaching other people — every channel. */
const PEOPLE_TOOLS: ToolDefinition[] = [
  LIST_CONTACTS_TOOL,
  SAVE_CONTACT_TOOL,
  UPDATE_MY_PROFILE_TOOL,
  TEXT_PERSON_TOOL,
  CALL_PERSON_TOOL,
];

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...PEOPLE_TOOLS,
  REPORT_ISSUE_TOOL,
  REQUEST_FEATURE_TOOL,
];
export const WRITE_TOOL_NAMES = new Set([
  ...WRITE_TOOLS.map((t) => t.name),
  ...PEOPLE_TOOLS.filter((t) => t !== LIST_CONTACTS_TOOL).map((t) => t.name),
  REPORT_ISSUE_TOOL.name,
  REQUEST_FEATURE_TOOL.name,
  SWITCH_BOOK_TOOL.name,
  SEND_TEXT_TOOL.name,
  SEND_MESSAGE_TOOL.name,
  CALL_ME_TOOL.name,
]);

/**
 * The tools offered on a channel: the phone / email threads may also switch book; a phone
 * call (VOICE) may also text the customer. step12b: every channel may send on another
 * channel (send_message) and — except a call itself — phone the customer (call_me).
 */
export function toolsFor(channel: Channel): ToolDefinition[] {
  if (channel === 'BOT')
    return [...ASSISTANT_TOOLS, SEND_MESSAGE_TOOL, CALL_ME_TOOL];
  if (channel === 'VOICE')
    return [
      ...ASSISTANT_TOOLS,
      SWITCH_BOOK_TOOL,
      SEND_TEXT_TOOL,
      SEND_MESSAGE_TOOL,
    ];
  return [
    ...ASSISTANT_TOOLS,
    SWITCH_BOOK_TOOL,
    SEND_MESSAGE_TOOL,
    CALL_ME_TOOL,
  ];
}
/**
 * Tools whose FAILURE is shown under the answer ("AI did:") and kept for the strong AI: every
 * write, and get_link — a link the customer asked for that could not be made is something
 * they must hear about, not a silent miss.
 */
const SHOWN_ON_FAILURE = new Set([...WRITE_TOOL_NAMES, 'get_link']);
const ALL_TOOL_NAMES = new Set(
  [
    ...ASSISTANT_TOOLS,
    SWITCH_BOOK_TOOL,
    SEND_TEXT_TOOL,
    SEND_MESSAGE_TOOL,
    CALL_ME_TOOL,
  ].map((t) => t.name),
);

type Args = Record<string, unknown>;
const s = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const id = (v: unknown): number => {
  const x = n(v);
  if (x === null || !Number.isInteger(x) || x <= 0)
    throw new Error('a valid id is required');
  return x;
};
/** step12: a schedule tool's arguments → the store's input (only what was given). */
const scheduleInput = (a: Args): AiScheduleInput => {
  const out: AiScheduleInput = {};
  if (typeof a.title === 'string') out.title = a.title;
  if (typeof a.task === 'string') out.task = a.task;
  if (
    a.frequency === 'DAILY' ||
    a.frequency === 'WEEKLY' ||
    a.frequency === 'MONTHLY'
  )
    out.frequency = a.frequency;
  if (typeof a.weekday === 'number') out.weekday = a.weekday;
  if (typeof a.monthDay === 'number') out.monthDay = a.monthDay;
  if (typeof a.time === 'string') out.time = a.time;
  if (typeof a.date === 'string') out.date = a.date;
  if (a.frequency === 'ONCE') out.frequency = 'ONCE';
  if (a.channel === 'SMS' || a.channel === 'EMAIL' || a.channel === 'CALL')
    out.channel = a.channel;
  if (a.channel === 'PREFERRED') out.channel = null;
  if (typeof a.active === 'boolean') out.active = a.active;
  return out;
};
/** "the financial report 2026-09-01 – 2026-09-30" — what a get_link pointed at. */
const linkLabel = (ref: Record<string, unknown>): string => {
  const v = (x: unknown, none: string) =>
    typeof x === 'string' || typeof x === 'number' ? String(x) : none;
  const period =
    ref.from || ref.to ? ` ${v(ref.from, '…')} – ${v(ref.to, '…')}` : '';
  if (ref.type === 'statement') return `statement #${v(ref.statementId, '?')}`;
  if (ref.type === 'attachment') return `file #${v(ref.attachmentId, '?')}`;
  if (ref.type === 'report') return `the financial report${period}`;
  return `the ledger (${v(ref.format, 'pdf')})${period}`;
};
const json = (v: unknown) => {
  const text = JSON.stringify(v);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… (cut — narrow the search)`
    : text;
};

/**
 * The assistant's hands (step11): every tool runs on the conversation's BOOK through the
 * same services the website uses, so it can never reach another customer's or another
 * book's data, and it obeys the same validation. Writes are applied directly (user's
 * decision) and each one is reported back as an action.
 */
@Injectable()
export class AssistantTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookkeeping: BookkeepingService,
    private readonly reports: ReportsService,
    private readonly tax: TaxService,
    private readonly accounts: CustomerAccountsService,
    private readonly attachments: AttachmentsService,
    private readonly processor: AttachmentProcessorService,
    private readonly names: NameMemoryService,
    private readonly splits: SplitsService,
    private readonly rules: RulesService,
    private readonly links: FileLinkService,
    private readonly messenger?: CustomerMessenger,
    /** step12: the schedules the customer asks for (absent in old specs). */
    @Optional() private readonly aiSchedules?: AiSchedulesStore,
    /** step12b: every channel's history, and sending on another channel. */
    @Optional() private readonly history?: CommunicationsHistory,
    @Optional() private readonly outbox?: CustomerOutbox,
    /** step12c: the people the AI calls / texts for the customer. */
    @Optional() private readonly contacts?: AiContactsService,
  ) {}

  private readonly logger = new Logger(AssistantTools.name);

  /** step12: set by `StrongAiService` (it depends on this class, so not injected here). */
  private issueHandler: IssueHandler | null = null;

  setIssueHandler(handler: IssueHandler): void {
    this.issueHandler = handler;
  }

  /** step12b: set by `VoiceCallsService` (it depends on this class). */
  private callHandler: CallHandler | null = null;

  setCallHandler(handler: CallHandler): void {
    this.callHandler = handler;
  }

  /** step12c: set by `VoiceCallsService` — call_person. */
  private personCallHandler: PersonCallHandler | null = null;

  setPersonCallHandler(handler: PersonCallHandler): void {
    this.personCallHandler = handler;
  }

  /** step12c: texts sent to other people today, per customer (pm2 runs one fork). */
  private readonly textsToOthers = new Map<string, number>();

  private contactsService(): AiContactsService {
    if (!this.contacts) throw new Error('contacts are not available');
    return this.contacts;
  }

  /**
   * step12c: who a call_person / text_person reaches — a saved contact of THIS customer, or a
   * number the customer gave. Never one of our own receipt numbers.
   */
  private async person(customerId: number, a: Args): Promise<PersonTarget> {
    const contacts = this.contactsService();
    if (n(a.contactId) !== null) {
      const c = await contacts.get(customerId, id(a.contactId));
      if (!c.phoneE164) throw new Error(`${c.name} has no phone number saved`);
      return { phone: c.phoneE164, contactId: c.id, name: c.name };
    }
    const raw = s(a.phone);
    if (!raw)
      throw new Error(
        'say who: a contactId from list_contacts, or a phone number',
      );
    const phone = toE164(raw);
    if (!phone)
      throw new Error(
        'that is not a phone number I can dial — ask for it with the area code (and the country code outside Canada / the US)',
      );
    const ours = await this.prisma.intakeNumber.findFirst({
      where: { phoneNumber: phone },
      select: { id: true },
    });
    if (ours) throw new Error('that is our own number');
    const saved = await contacts.byPhone(customerId, phone);
    return {
      phone,
      contactId: saved?.id ?? null,
      name: saved?.name ?? s(a.name),
    };
  }

  private schedulesStore(): AiSchedulesStore {
    if (!this.aiSchedules) throw new Error('schedules are not available');
    return this.aiSchedules;
  }

  /** step12: the book's built-in schedules and its AI-made ones, for the model. */
  private async schedulesList(scope: BookScope) {
    const builtIn = await this.prisma.bookSchedule.findMany({
      where: scopeWhere(scope),
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

  /** Runs one tool. Never throws: a failure is reported to the model (and as a failed action). */
  async run(
    name: string,
    rawArgs: string,
    ctx: ToolContext,
  ): Promise<ToolOutcome> {
    let args: Args;
    try {
      args = (JSON.parse(rawArgs || '{}') ?? {}) as Args;
    } catch {
      return { content: json({ error: 'arguments were not valid JSON' }) };
    }
    if (!ALL_TOOL_NAMES.has(name)) {
      return { content: json({ error: `unknown tool ${name}` }) };
    }
    try {
      return await this.exec(name, args, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A failed read leaves no other trace (only writes are stored as actions).
      this.logger.warn(
        `tool ${name} failed (conversation ${ctx.conversation?.id ?? '-'}): ${message}`,
      );
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

  private async exec(
    name: string,
    a: Args,
    ctx: ToolContext,
  ): Promise<ToolOutcome> {
    const { scope } = ctx;
    const done = (
      summary: string,
      data: unknown = { ok: true },
    ): ToolOutcome => ({
      content: json(data),
      action: { tool: name, ok: true, summary },
      // The attachment a write tool acted on, linked to the answer (step11b).
      ...(typeof a.attachmentId === 'number' && a.attachmentId > 0
        ? { attachmentId: a.attachmentId }
        : {}),
    });

    switch (name) {
      case 'list_statements': {
        const list = await this.bookkeeping.list(scope);
        return {
          content: json(
            listStatements(list, {
              account: s(a.account),
              from: s(a.from),
              to: s(a.to),
              status: s(a.status),
              limit: n(a.limit),
            }),
          ),
        };
      }
      case 'search_transactions': {
        const rows = (await this.bookkeeping.transactions(
          scope,
        )) as unknown as LedgerRow[];
        return {
          content: json(
            filterTransactions(rows, {
              from: s(a.from),
              to: s(a.to),
              name: s(a.name),
              category: s(a.category),
              text: s(a.text),
              minAmount: n(a.minAmount),
              maxAmount: n(a.maxAmount),
              direction:
                a.direction === 'in' || a.direction === 'out'
                  ? a.direction
                  : null,
              limit: n(a.limit),
            }),
          ),
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
          content: json(
            (await this.accounts.list(scope)).map((c) => ({
              name: c.name,
              type: c.type,
            })),
          ),
        };
      case 'list_attachments': {
        const status = s(a.status);
        const list = (await this.attachments.list(scope))
          .filter((x) => !status || x.status === status)
          .slice(0, 60);
        return {
          content: json(
            list.map((x) => ({
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
            })),
          ),
        };
      }
      case 'get_attachment':
        return {
          content: json(await this.attachments.get(scope, id(a.attachmentId))),
        };
      case 'find_match_candidates':
        return {
          content: json(
            await this.processor.candidatesFor(scope, id(a.attachmentId), {
              from: s(a.from),
              to: s(a.to),
              amount: n(a.amount),
              text: s(a.text),
            }),
          ),
        };
      case 'list_rules':
        return { content: json(await this.rules.listCustomerRules(scope)) };
      case 'get_link': {
        const type = s(a.type);
        if (
          type !== 'statement' &&
          type !== 'attachment' &&
          type !== 'report' &&
          type !== 'ledger'
        ) {
          throw new Error(
            'type must be statement, attachment, report or ledger',
          );
        }
        const url = await this.links.link(scope, {
          kind: type,
          id:
            type === 'statement'
              ? id(a.statementId)
              : type === 'attachment'
                ? id(a.attachmentId)
                : undefined,
          from: s(a.from),
          to: s(a.to),
          format: a.format === 'xlsx' ? 'xlsx' : 'pdf',
        });
        // step12b: kept on the answer, so "resend that" on any channel can make it again.
        const ref: Record<string, unknown> = { type };
        if (type === 'statement') ref.statementId = id(a.statementId);
        if (type === 'attachment') ref.attachmentId = id(a.attachmentId);
        if (s(a.from)) ref.from = s(a.from);
        if (s(a.to)) ref.to = s(a.to);
        if (type === 'ledger')
          ref.format = a.format === 'xlsx' ? 'xlsx' : 'pdf';
        const shared: AgentAction = {
          tool: 'get_link',
          ok: true,
          summary: `Shared a link to ${linkLabel(ref)}`,
          ref,
        };
        if (ctx.links) {
          return {
            content: json({
              link: addLink(ctx.links, url),
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
        const ids = (v: unknown) =>
          Array.isArray(v)
            ? v.filter((x): x is number => Number.isInteger(x) && x > 0)
            : [];
        const report: IssueReport = {
          complaint: s(a.complaint) ?? '',
          whatWentWrong: s(a.whatWentWrong) ?? '',
          attachmentIds: ids(a.attachmentIds),
          transactionIds: ids(a.transactionIds),
        };
        const outcome: IssueOutcome = this.issueHandler
          ? await this.issueHandler(ctx, report)
          : {
              instructions:
                'Nobody can check this right now. Apologise, fix what the customer asked with your tools, and continue as you normally would.',
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
      case 'request_feature': {
        const request = s(a.request);
        if (!request) throw new Error('say what the customer asked for');
        const saved = await saveFeatureRequest(this.prisma, {
          scope,
          conversationId: ctx.conversation?.id ?? null,
          channel: ctx.conversation?.channel ?? 'BOT',
          messageId: ctx.messageId,
          request,
          summary: s(a.summary) ?? request,
        });
        return done(`Saved your request: ${saved.summary}`, {
          ok: true,
          requestId: saved.id,
          result:
            'Tell the customer we noted it, the team will look at it, and they can follow it under "My requests" on the website. Do not promise it will be built.',
        });
      }
      case 'send_text': {
        const raw = s(a.text);
        const body = raw ? fillLinks(raw, ctx.links) : raw;
        const peer = ctx.conversation?.peer;
        if (!body) throw new Error('nothing to text');
        if (!peer || !this.messenger)
          throw new Error('texting is not available');
        const outcome = await this.messenger.send({
          channel: 'SMS',
          to: peer,
          body,
          meta: { ...scope, purpose: 'SEND_TEXT' },
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
        if (!raw) throw new Error('nothing to send');
        if (!this.outbox) throw new Error('sending is not available');
        const sent = await this.outbox.send(
          scope,
          channel as OutboxChannel,
          fillLinks(raw, ctx.links),
          s(a.subject),
        );
        if (!sent.ok) throw new Error(sent.error);
        const how =
          channel === 'EMAIL'
            ? `Emailed ${sent.to}`
            : channel === 'SMS'
              ? 'Texted the customer'
              : 'WhatsApped the customer';
        return done(how, { ok: true, sentTo: sent.to });
      }
      case 'call_me': {
        const about = s(a.about);
        if (!about) throw new Error('say what the call is about');
        if (!this.callHandler) throw new Error('phone calls are not available');
        const placed = await this.callHandler(ctx, about.slice(0, 500));
        if (!placed.ok) throw new Error(placed.error);
        return done(placed.summary, {
          ok: true,
          note: 'Their phone rings in a few seconds. Tell them to pick up — keep this reply short.',
        });
      }
      case 'list_contacts': {
        const list = await this.contactsService().list(scope.customerId);
        return {
          content: json(
            list.map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              email: c.email,
              note: c.note,
            })),
          ),
        };
      }
      case 'save_contact': {
        const name = s(a.name);
        if (!name) throw new Error('a contact needs a name');
        const saved = await this.contactsService().save(scope.customerId, {
          name,
          ...(s(a.phone) ? { phone: s(a.phone) } : {}),
          ...(s(a.email) ? { email: s(a.email) } : {}),
          ...(s(a.note) ? { note: s(a.note) } : {}),
        });
        return done(`Saved ${saved.name} to your contacts`, {
          ok: true,
          contactId: saved.id,
        });
      }
      case 'update_my_profile': {
        const name = s(a.name)?.slice(0, 120);
        const alerts =
          typeof a.transactionAlerts === 'boolean'
            ? a.transactionAlerts
            : undefined;
        if (!name && alerts === undefined)
          throw new Error('say the name to save, or transactionAlerts');
        await this.prisma.customer.update({
          where: { id: scope.customerId },
          data: {
            ...(name ? { name } : {}),
            ...(alerts !== undefined ? { transactionAlerts: alerts } : {}),
          },
        });
        return done(
          [
            name ? `Saved your name as ${name}` : null,
            alerts === undefined
              ? null
              : `Transaction alerts are ${alerts ? 'on' : 'off'}`,
          ]
            .filter(Boolean)
            .join('. '),
        );
      }
      case 'text_person': {
        const message = s(a.message);
        if (!message) throw new Error('nothing to text');
        if (!this.messenger) throw new Error('texting is not available');
        const who = await this.person(scope.customerId, a);
        const key = `${scope.customerId}:${new Date().toISOString().slice(0, 10)}`;
        const sentToday = this.textsToOthers.get(key) ?? 0;
        if (sentToday >= textsToOthersPerDay()) {
          throw new Error(
            "today's limit of texts to other people is reached — try again tomorrow",
          );
        }
        const me = await this.prisma.customer.findUnique({
          where: { id: scope.customerId },
          select: { name: true },
        });
        const from = me?.name?.trim() || 'A CYG Finance customer';
        const outcome = await this.messenger.send({
          channel: 'SMS',
          to: who.phone,
          body: `From ${from} (sent by CYG Finance's assistant): ${fillLinks(message, ctx.links)}`,
          meta: { ...scope, purpose: 'TEXT_PERSON' },
        });
        if (outcome !== 'sent')
          throw new Error(`the text was not sent (${outcome})`);
        this.textsToOthers.set(key, sentToday + 1);
        if (who.contactId) await this.contactsService().touched(who.contactId);
        return done(`Texted ${who.name ?? who.phone} (${who.phone})`, {
          ok: true,
          savedContact: !!who.contactId,
        });
      }
      case 'call_person': {
        const message = s(a.message);
        if (!message) throw new Error('say what to tell them');
        if (!this.personCallHandler)
          throw new Error('phone calls are not available');
        const who = await this.person(scope.customerId, a);
        const placed = await this.personCallHandler(
          ctx,
          who,
          message.slice(0, 1000),
        );
        if (!placed.ok) throw new Error(placed.error);
        if (who.contactId) await this.contactsService().touched(who.contactId);
        return done(placed.summary, {
          ok: true,
          note: 'The call starts in a few seconds. Tell the customer you will let them know how it went.',
        });
      }
      case 'search_communications': {
        if (!this.history) throw new Error('history is not available');
        return {
          content: json(
            await this.history.search(scope.customerId, {
              channel: s(a.channel),
              query: s(a.query),
              from: s(a.from),
              to: s(a.to),
              limit: n(a.limit),
            }),
          ),
        };
      }

      case 'attach_receipt': {
        const view = await this.attachments.setTransaction(
          scope,
          id(a.attachmentId),
          id(a.transactionId),
        );
        const understood = a.understood !== false;
        const t = view.transaction;
        const out = done(
          `Attached ${view.filename} to ${t?.name ?? t?.description ?? `transaction ${id(a.transactionId)}`}${t ? ` ($${Math.abs(t.amount).toFixed(2)})` : ''}`,
        );
        return understood ? out : { ...out, warning: NOT_UNDERSTOOD_WARNING };
      }
      case 'detach_receipt': {
        const view = await this.attachments.setTransaction(
          scope,
          id(a.attachmentId),
          null,
        );
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
        return done(
          `Transaction ${id(a.transactionId)} ${what}${always ? ' (every row like it)' : ''}`,
        );
      }
      case 'save_name_rule': {
        const from = s(a.name);
        if (!from) throw new Error('which name?');
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
        return done(
          `${from}${values.name && values.name !== from ? ` → ${values.name}` : ''}${values.category ? ` filed under ${values.category}` : ''} everywhere`,
        );
      }
      case 'create_category': {
        const type = s(a.type) as AccountType | null;
        if (!type || !ACCOUNT_TYPES.includes(type))
          throw new Error('choose the kind of account');
        const created = await this.accounts.create(scope, {
          name: s(a.name) ?? '',
          type,
        });
        return done(`Created the category ${created.name}`);
      }
      case 'save_splits': {
        const list = Array.isArray(a.splits) ? (a.splits as Args[]) : [];
        await this.splits.save(
          scope,
          id(a.transactionId),
          list.map((x) => ({
            name: s(x.name),
            category: s(x.category) ?? '',
            amount: n(x.amount) ?? 0,
          })),
        );
        return done(
          list.length
            ? `Split transaction ${id(a.transactionId)} into ${list.length} part${list.length === 1 ? '' : 's'}`
            : `Removed the splits of transaction ${id(a.transactionId)}`,
        );
      }
      case 'move_statement': {
        const view = await this.bookkeeping.moveStatement(
          scope,
          id(a.statementId),
          s(a.accountName) ?? '',
        );
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
        const row = await this.schedulesStore().create(
          scope,
          scheduleInput(a),
          { createdBy: 'AI', conversationId: ctx.conversation?.id ?? null },
        );
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
        const row = await this.schedulesStore().update(
          scope,
          id(a.scheduleId),
          scheduleInput(a),
        );
        const when = this.schedulesStore().describe(row);
        return done(
          `Updated "${row.title}" — ${row.active ? when : 'paused'}`,
          {
            ok: true,
            id: row.id,
            when,
            active: row.active,
          },
        );
      }
      case 'delete_schedule': {
        const row = await this.schedulesStore().remove(scope, id(a.scheduleId));
        return done(`Removed the schedule "${row.title}"`);
      }
      case 'save_rule': {
        const text = s(a.text);
        if (!text) throw new Error('the rule needs words');
        const global = a.scope === 'global';
        const saved = global
          ? await this.rules.proposeGlobalRule(
              text,
              a.topic,
              scope.customerId,
              ctx.messageId,
            )
          : await this.rules.saveCustomerRule(
              scope,
              text,
              a.topic,
              ctx.messageId,
            );
        return done(
          !saved
            ? `Already knew: "${text}"`
            : global
              ? `Suggested to the CYG team: "${text}"`
              : `Learned for next time: "${text}"`,
        );
      }
    }
    return { content: json({ error: `unknown tool ${name}` }) };
  }

  /**
   * step11b: the phone / email thread now works on another book, and the files this phone
   * sent in the last minutes follow it (`moveRecentFiles`). The rest of THIS answer still
   * runs on the book it started in; the next message runs on the new one.
   */
  private async switchBook(
    ctx: ToolContext,
    book: string | null,
  ): Promise<ToolOutcome> {
    const conversation = ctx.conversation;
    if (!conversation || conversation.channel === 'BOT' || !conversation.peer) {
      throw new Error('books are switched on the website with the book picker');
    }
    const options = await bookOptions(this.prisma, conversation.customerId);
    const found = bookCandidates(book, options);
    if (found.length !== 1) {
      return {
        content: json({
          error: found.length
            ? whichBookQuestion(found, options)
            : `No book called "${book ?? ''}". The books are: ${options.map((o, i) => `${i + 1} ${o.name}`).join(', ')}`,
        }),
      };
    }
    const choice = found[0];
    const updated = await chooseBook(this.prisma, conversation, choice);
    const { moved, reread } = await moveRecentFiles(
      this.prisma,
      updated,
      conversation.peer,
      choice,
    );
    if (reread) this.processor.processSoon();
    return {
      content: json({ ok: true, book: choice.name, filesMoved: moved }),
      action: {
        tool: 'switch_book',
        ok: true,
        summary: `This chat now works on ${choice.name}${moved ? ` (moved ${moved} file${moved === 1 ? '' : 's'} there)` : ''}`,
      },
    };
  }

  /**
   * A PDF that came in as an attachment (a texted statement) becomes an UPLOADED statement
   * on the SAME stored file — nothing is copied — and the attachment is soft-deleted. The
   * customer clicks Generate to read it, like any upload.
   */
  private async fileAsStatement(
    scope: BookScope,
    attachmentId: number,
  ): Promise<string> {
    const a = await this.prisma.transactionAttachment.findFirst({
      where: { id: attachmentId, ...scopeWhere(scope), deletedAt: null },
    });
    if (!a) throw new Error('attachment not found');
    if (a.mimeType !== 'application/pdf')
      throw new Error('only a PDF can be a statement');
    if (a.status === AttachmentStatus.PROCESSING)
      throw new Error('it is being read right now');
    await this.prisma.$transaction([
      this.prisma.bankStatement.create({
        data: {
          ...scopeWhere(scope),
          filename: a.filename.slice(0, 191),
          storageKey: a.storageKey,
          sizeBytes: a.size,
          // The channel it came by, for the Communication tab.
          source: a.source === 'STATEMENT' ? 'UPLOAD' : a.source,
          status: StatementStatus.UPLOADED,
        },
      }),
      this.prisma.transactionAttachment.update({
        where: { id: a.id },
        data: { deletedAt: new Date() },
      }),
    ]);
    return `Filed ${a.filename} as a bank statement — click Generate on the Bank feeds tab to read it`;
  }
}
