/**
 * step12b — what the assistant remembers from the customer's OTHER channels (pure, so the
 * limits and wording are tested without a database). The customer talks to one agent on the
 * website, by text, WhatsApp, email and on the phone; each channel is its own conversation,
 * so without this a text saying "resend the docs I told you about on the phone" found nothing.
 */
import { DEFAULT_TIMEZONE } from '../schedules/next-run.util';

/** One stored message, with the files it carried or touched. */
export interface HistoryRow {
  id: number;
  channel: string;
  role: string;
  text: string;
  createdAt: Date;
  companyId: number | null;
  /** `AiMessage.actions` as stored. */
  actions: unknown;
  files: { attachmentId: number; filename: string; removed: boolean }[];
}

export const CHANNEL_LABEL: Record<string, string> = {
  BOT: 'Website chat',
  SMS: 'Text',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  VOICE: 'Phone call',
};

/** How far back, and how much, the automatic block carries. */
export const OTHER_CHANNELS = {
  hours: 72,
  maxRows: 12,
  maxLine: 300,
  maxChars: 3000,
};

/** A link the AI made in that answer (`get_link`'s action `ref`), so it can be made again. */
export interface LinkRef {
  type: string;
  statementId?: number;
  attachmentId?: number;
  from?: string | null;
  to?: string | null;
  format?: string;
}

interface StoredAction {
  tool?: unknown;
  ok?: unknown;
  summary?: unknown;
  ref?: unknown;
}

const actionsOf = (raw: unknown): StoredAction[] =>
  Array.isArray(raw)
    ? raw.filter((a): a is StoredAction => !!a && typeof a === 'object')
    : [];

/** What the AI did in that answer, in words (successful actions only). */
export function doneOf(raw: unknown): string[] {
  return actionsOf(raw)
    .filter((a) => a.ok === true && typeof a.summary === 'string')
    .map((a) => a.summary as string);
}

/** The links the AI made in that answer. */
export function linksOf(raw: unknown): LinkRef[] {
  return actionsOf(raw)
    .filter(
      (a) =>
        a.ok === true &&
        a.tool === 'get_link' &&
        !!a.ref &&
        typeof a.ref === 'object' &&
        typeof (a.ref as LinkRef).type === 'string',
    )
    .map((a) => a.ref as LinkRef);
}

const cut = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** "Tue Oct 21, 3:12 PM" in the firm's zone. */
export function whenLabel(at: Date, tz = DEFAULT_TIMEZONE): string {
  return at.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One message as one line for the model. */
export function historyLine(
  r: HistoryRow,
  opts: {
    currentCompanyId: number | null;
    bookName: (id: number | null) => string;
  },
  maxLine = OTHER_CHANNELS.maxLine,
): string {
  const head = [
    CHANNEL_LABEL[r.channel] ?? r.channel,
    whenLabel(r.createdAt),
    r.role === 'USER' ? 'customer' : 'you',
    ...(r.companyId !== opts.currentCompanyId
      ? [opts.bookName(r.companyId)]
      : []),
  ].join(' · ');
  const files = r.files.length
    ? ` (files: ${r.files
        .map(
          (f) =>
            `#${f.attachmentId} "${f.filename}"${f.removed ? ' removed' : ''}`,
        )
        .join(', ')})`
    : '';
  const done = doneOf(r.actions);
  const did = done.length ? ` [Done: ${cut(done.join('; '), 200)}]` : '';
  return `[${head}] ${cut(r.text, maxLine)}${files}${did}`;
}

/**
 * The prompt block: the newest messages from the customer's other conversations (any
 * channel, any book), oldest first, within the limits. Null when there is nothing.
 */
export function otherChannelsBlock(
  rows: HistoryRow[],
  opts: {
    now: Date;
    currentCompanyId: number | null;
    bookName: (id: number | null) => string;
  },
): string | null {
  const since = opts.now.getTime() - OTHER_CHANNELS.hours * 3600_000;
  const recent = rows
    .filter((r) => r.createdAt.getTime() >= since && r.text.trim())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, OTHER_CHANNELS.maxRows);
  const lines: string[] = [];
  let used = 0;
  for (const r of recent) {
    const line = historyLine(r, opts);
    if (used + line.length > OTHER_CHANNELS.maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return null;
  return (
    "RECENT ON THE CUSTOMER'S OTHER CHANNELS (the same customer, talking to you elsewhere; " +
    'oldest first). Use it when they refer to something said or sent there ("the docs I ' +
    'told you about on the phone"). For anything older or not here, call search_communications.\n' +
    lines.reverse().join('\n')
  );
}

/** One `search_communications` hit for the model. */
export function searchHit(
  r: HistoryRow,
  bookName: (id: number | null) => string,
) {
  return {
    messageId: r.id,
    at: r.createdAt.toISOString(),
    when: whenLabel(r.createdAt),
    channel: CHANNEL_LABEL[r.channel] ?? r.channel,
    book: bookName(r.companyId),
    who: r.role === 'USER' ? 'customer' : 'assistant',
    text: cut(r.text, 600),
    ...(r.files.length ? { files: r.files } : {}),
    ...(linksOf(r.actions).length ? { linksSent: linksOf(r.actions) } : {}),
    ...(doneOf(r.actions).length ? { done: doneOf(r.actions) } : {}),
  };
}
