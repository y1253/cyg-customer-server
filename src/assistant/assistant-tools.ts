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
import { addLink, fillLinks, type LinkBook } from './links.util';

/** One thing the agent did, shown under its answer and kept in `AiMessage.actions`. */
export interface AgentAction {
  tool: string;
  ok: boolean;
  summary: string;
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
      "This book's bank / card statements: account, period, status, row count.",
    parameters: obj({}),
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
      'The customer asks for something sent to them REPEATEDLY ("text me my financial report every day at 6am", "email me unmatched receipts every Friday"). Saves a schedule in this book; each time it fires, an assistant answers `task` with the read tools and sends the answer. Ask first when the time or day is missing. time = "HH:mm" 24 h in their time zone. channel: SMS for "text me", EMAIL for "email me", omit for their preferred contact. Confirm back what you saved in words (e.g. "every day at 6:00 AM by text").',
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
        frequency: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
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
        channel: { type: 'string', enum: ['SMS', 'EMAIL'] },
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
        frequency: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
        weekday: { type: 'integer', minimum: 0, maximum: 6 },
        monthDay: { type: 'integer', minimum: 0, maximum: 28 },
        time: { type: 'string', description: 'HH:mm, 24 h' },
        channel: { type: 'string', enum: ['SMS', 'EMAIL', 'PREFERRED'] },
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

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  REPORT_ISSUE_TOOL,
];
export const WRITE_TOOL_NAMES = new Set([
  ...WRITE_TOOLS.map((t) => t.name),
  REPORT_ISSUE_TOOL.name,
  SWITCH_BOOK_TOOL.name,
  SEND_TEXT_TOOL.name,
]);

/**
 * The tools offered on a channel: the phone / email threads may also switch book; a phone
 * call (VOICE) may also text the customer.
 */
export function toolsFor(channel: Channel): ToolDefinition[] {
  if (channel === 'BOT') return ASSISTANT_TOOLS;
  if (channel === 'VOICE')
    return [...ASSISTANT_TOOLS, SWITCH_BOOK_TOOL, SEND_TEXT_TOOL];
  return [...ASSISTANT_TOOLS, SWITCH_BOOK_TOOL];
}
/**
 * Tools whose FAILURE is shown under the answer ("AI did:") and kept for the strong AI: every
 * write, and get_link — a link the customer asked for that could not be made is something
 * they must hear about, not a silent miss.
 */
const SHOWN_ON_FAILURE = new Set([...WRITE_TOOL_NAMES, 'get_link']);
const ALL_TOOL_NAMES = new Set(
  [...ASSISTANT_TOOLS, SWITCH_BOOK_TOOL, SEND_TEXT_TOOL].map((t) => t.name),
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
  if (a.channel === 'SMS' || a.channel === 'EMAIL') out.channel = a.channel;
  if (a.channel === 'PREFERRED') out.channel = null;
  if (typeof a.active === 'boolean') out.active = a.active;
  return out;
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
  ) {}

  private readonly logger = new Logger(AssistantTools.name);

  /** step12: set by `StrongAiService` (it depends on this class, so not injected here). */
  private issueHandler: IssueHandler | null = null;

  setIssueHandler(handler: IssueHandler): void {
    this.issueHandler = handler;
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
            list.map((x) => ({
              id: x.id,
              label: x.label,
              status: x.status,
              account: x.accountName,
              periodStart: x.periodStart,
              periodEnd: x.periodEnd,
              transactions: x.transactionCount,
              error: x.error,
            })),
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
        if (ctx.links) {
          return {
            content: json({
              link: addLink(ctx.links, url),
              expiresInDays: 7,
              note: 'Write this placeholder exactly where the link goes; it is replaced with the real link when your answer is sent. Never write a link yourself.',
            }),
            ...(type === 'attachment'
              ? { attachmentId: id(a.attachmentId) }
              : {}),
          };
        }
        return {
          content: json({ url, expiresInDays: 7 }),
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
        });
        if (outcome !== 'sent')
          throw new Error(`the text was not sent (${outcome})`);
        return done('Texted the customer', { ok: true });
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
      choice.companyId,
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
    return `Filed ${a.filename} as a bank statement — click Generate on the Statements tab to read it`;
  }
}
