/**
 * The Communication tab (step12): everything a customer exchanged with us, one chat per
 * channel — WhatsApp, text, email, the website chat — plus what they uploaded on the site.
 * Pure, so the merge (messages + files that came in without one) is tested without a DB.
 */

export type CommChannel =
  | 'WHATSAPP'
  | 'SMS'
  | 'VOICE'
  | 'EMAIL'
  | 'BOT'
  | 'UPLOADS';
export const COMM_CHANNELS: readonly CommChannel[] = [
  'WHATSAPP',
  'SMS',
  'VOICE',
  'EMAIL',
  'BOT',
  'UPLOADS',
];
export const isCommChannel = (c: unknown): c is CommChannel =>
  typeof c === 'string' && (COMM_CHANNELS as readonly string[]).includes(c);

/** The channels that are conversations with the AI (`AiConversation.channel`). */
export const MESSAGE_CHANNELS = [
  'WHATSAPP',
  'SMS',
  'VOICE',
  'EMAIL',
  'BOT',
] as const;
/** Where a texted / emailed file says it came from (`TransactionAttachment.source`). */
export const FILE_SOURCE: Partial<Record<CommChannel, string>> = {
  WHATSAPP: 'WHATSAPP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  // step11b: a file added in the website chat — listed in that chat, not under Uploads.
  BOT: 'CHAT',
};

export interface CommFile {
  /** attachment = `TransactionAttachment`, statement = `BankStatement`. */
  type: 'attachment' | 'statement';
  id: number;
  filename: string;
  mimeType: string | null;
  status: string;
}

/** step12: one AI phone call on the VOICE channel (its words are the messages around it). */
export interface CommCall {
  id: number;
  /** INBOUND = they called us; OUTBOUND = the AI called them (a scheduled message). */
  direction: string;
  /** INBOUND | ACCOUNT_STATUS | FINANCIAL_REPORT */
  purpose: string;
  status: string;
  durationSec: number | null;
  hasRecording: boolean;
}

export interface CommItem {
  key: string;
  /** ISO time. */
  at: string;
  /** customer = they sent it (right side); cyg = we / the assistant answered (left). */
  side: 'customer' | 'cyg';
  /** message = a chat message; upload = a file that arrived with no message logged; call = a phone call. */
  kind: 'message' | 'upload' | 'call';
  text: string | null;
  files: CommFile[];
  warning?: string | null;
  call?: CommCall;
}

export interface CallIn extends CommCall {
  startedAt: Date;
}

export interface MessageIn {
  id: number;
  role: string;
  text: string;
  warning: string | null;
  attachmentIds: unknown;
  createdAt: Date;
}

export interface AttachmentIn {
  id: number;
  filename: string;
  mimeType: string;
  status: string;
  message: string | null;
  createdAt: Date;
}

export interface StatementIn {
  id: number;
  filename: string;
  status: string;
  createdAt: Date;
}

/** `AiMessage.attachmentIds` (Json) as numbers; anything else is ignored. */
export function idsOf(json: unknown): number[] {
  return Array.isArray(json)
    ? json.filter((n): n is number => Number.isInteger(n) && n > 0)
    : [];
}

/** "[sent a file]" — the placeholder the intake agent logs for a message with no words. */
const FILE_LABEL = /^\[sent (a file|\d+ files)\]$/;

const fileOf = (a: AttachmentIn): CommFile => ({
  type: 'attachment',
  id: a.id,
  filename: a.filename,
  mimeType: a.mimeType,
  status: a.status,
});

/**
 * One page of a channel's chat, NEWEST first.
 * - messages: each with the files it is linked to (`files` looked up by id — the caller
 *   loads deleted ones too and marks them REMOVED, so a conversation keeps showing a file
 *   the customer deleted since; an id missing from the map is left out),
 * - loose: files of that channel no message refers to (sent while the assistant was off,
 *   or uploaded on the website) — each its own "upload" bubble, with the words sent with it,
 * - statements: statements uploaded on the website.
 */
export function buildTimeline(input: {
  messages: MessageIn[];
  files: ReadonlyMap<number, AttachmentIn>;
  loose: AttachmentIn[];
  statements: StatementIn[];
  /** step12: the VOICE channel's calls. */
  calls?: CallIn[];
}): CommItem[] {
  const items: CommItem[] = [
    ...(input.calls ?? []).map(
      (c): CommItem => ({
        key: `c:${c.id}`,
        at: c.startedAt.toISOString(),
        side: c.direction === 'OUTBOUND' ? 'cyg' : 'customer',
        kind: 'call',
        text: null,
        files: [],
        call: {
          id: c.id,
          direction: c.direction,
          purpose: c.purpose,
          status: c.status,
          durationSec: c.durationSec,
          hasRecording: c.hasRecording,
        },
      }),
    ),
    ...input.messages.map((m): CommItem => {
      const files = idsOf(m.attachmentIds)
        .map((id) => input.files.get(id))
        .filter((a): a is AttachmentIn => !!a)
        .map(fileOf);
      return {
        key: `m:${m.id}`,
        at: m.createdAt.toISOString(),
        side: m.role === 'USER' ? 'customer' : 'cyg',
        kind: 'message',
        text: files.length && FILE_LABEL.test(m.text) ? null : m.text,
        files,
        ...(m.warning && { warning: m.warning }),
      };
    }),
    ...input.loose.map(
      (a): CommItem => ({
        key: `a:${a.id}`,
        at: a.createdAt.toISOString(),
        side: 'customer',
        kind: 'upload',
        text: a.message?.trim() || null,
        files: [fileOf(a)],
      }),
    ),
    ...input.statements.map(
      (s): CommItem => ({
        key: `s:${s.id}`,
        at: s.createdAt.toISOString(),
        side: 'customer',
        kind: 'upload',
        text: null,
        files: [
          {
            type: 'statement',
            id: s.id,
            filename: s.filename,
            mimeType: 'application/pdf',
            status: s.status,
          },
        ],
      }),
    ),
  ];
  return items.sort(
    (a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key),
  );
}

/** The first `limit` items, and the cursor for the page after them (null = no more). */
export function pageOf(
  items: CommItem[],
  limit: number,
): { items: CommItem[]; nextBefore: string | null } {
  const page = items.slice(0, limit);
  return {
    items: page,
    nextBefore: items.length > limit ? page[page.length - 1].at : null,
  };
}

/** The preview line on the channel list. */
export function previewOf(item: CommItem | undefined): string | null {
  if (!item) return null;
  const who = item.side === 'cyg' ? 'CYG: ' : '';
  if (item.call) {
    return item.call.direction === 'OUTBOUND'
      ? '📞 We called you'
      : '📞 You called us';
  }
  if (item.text) return `${who}${item.text.replace(/\s+/g, ' ').slice(0, 120)}`;
  const f = item.files[0];
  if (!f) return null;
  const more = item.files.length > 1 ? ` +${item.files.length - 1}` : '';
  return `${who}📎 ${f.filename}${more}`;
}
