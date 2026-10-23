import type { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from '../bookkeeping/scope';

/** step12e: a feature request's status — staff set it in the internal app. */
export const FEATURE_STATUSES = [
  'OPEN',
  'PLANNED',
  'DONE',
  'DECLINED',
] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

/** The same ask twice in one conversation this soon is one request, not two. */
export const DEDUPE_MS = 10 * 60_000;

export const SUMMARY_MAX = 200;
const REQUEST_MAX = 4_000;

/** A short one-line title: whitespace folded, clipped to the column. */
export function cleanSummary(raw: string): string {
  const one = raw.replace(/\s+/g, ' ').trim();
  return one.length > SUMMARY_MAX ? `${one.slice(0, SUMMARY_MAX - 1)}…` : one;
}

/** What the customer is told once staff mark the request DONE. */
export function featureDoneText(summary: string, note: string | null): string {
  const extra = note?.trim();
  return `Good news from CYG Finance — what you asked for is now available: ${summary}.${extra ? ` ${extra}` : ''}`;
}

export interface SaveFeatureRequestInput {
  scope: BookScope;
  conversationId: number | null;
  channel: string;
  messageId: number | null;
  request: string;
  summary: string;
}

/**
 * The assistant's `request_feature`: one row per ask. An OPEN request from the same
 * conversation in the last `DEDUPE_MS` is returned instead of adding a second one (the
 * agent may call the tool again while the customer explains more).
 */
export async function saveFeatureRequest(
  prisma: PrismaService,
  input: SaveFeatureRequestInput,
  now: Date = new Date(),
): Promise<{ id: number; summary: string }> {
  if (input.conversationId !== null) {
    const recent = await prisma.featureRequest.findFirst({
      where: {
        customerId: input.scope.customerId,
        conversationId: input.conversationId,
        status: 'OPEN',
        createdAt: { gte: new Date(now.getTime() - DEDUPE_MS) },
      },
      orderBy: { id: 'desc' },
      select: { id: true, summary: true },
    });
    if (recent) return recent;
  }
  return prisma.featureRequest.create({
    data: {
      customerId: input.scope.customerId,
      bookId: input.scope.bookId,
      companyId: input.scope.companyId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      channel: input.channel.slice(0, 12),
      request: input.request.trim().slice(0, REQUEST_MAX),
      summary: cleanSummary(input.summary) || cleanSummary(input.request),
    },
    select: { id: true, summary: true },
  });
}

export type DoneChannel = 'SMS' | 'EMAIL';

/**
 * Where the "it's available now" message goes: back to the phone that asked when it came
 * by text (a reply then has context), else the customer's preferred contact. WhatsApp is
 * not used — its 24-hour window has usually closed by the time a feature ships.
 */
export function doneTarget(
  origin: { channel: string; peer: string | null },
  smsConfigured: boolean,
  preferred: { channel: string | null; to: string | null },
): { channel: DoneChannel; to: string } | null {
  if (origin.channel === 'SMS' && origin.peer && smsConfigured)
    return { channel: 'SMS', to: origin.peer };
  if (
    (preferred.channel === 'SMS' || preferred.channel === 'EMAIL') &&
    preferred.to
  )
    return { channel: preferred.channel, to: preferred.to };
  return null;
}
