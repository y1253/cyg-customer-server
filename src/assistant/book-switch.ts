import { AttachmentStatus, type AiConversation } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { BookOption } from './assistant-prompt';

/** Marks the assistant message that asked "which books?" — moves are counted from it. */
export const ASK_BOOK = 'ask_book';

/** A switch takes along this phone's files from the last this-many minutes… */
const RECENT_MS = 10 * 60_000;
/** …and, after the book question, everything since a little before it was asked. */
const QUESTION_SLACK_MS = 5 * 60_000;
/** A book question older than this no longer explains where a file landed. */
const QUESTION_MAX_AGE_MS = 24 * 60 * 60_000;

/** "Personal" plus the customer's submitted businesses — the numbered choices. */
export async function bookOptions(
  prisma: PrismaService,
  customerId: number,
): Promise<BookOption[]> {
  const companies = await prisma.company.findMany({
    where: { customerId, isDraft: false, isInternal: false, deletedAt: null },
    orderBy: { businessName: 'asc' },
    select: { id: true, businessName: true },
  });
  return [
    { companyId: null, name: 'Personal' },
    ...companies.map((c) => ({ companyId: c.id, name: c.businessName })),
  ];
}

/** The conversation now works in `choice`'s book (any channel). */
export function chooseBook(
  prisma: PrismaService,
  conversation: AiConversation,
  choice: BookOption,
): Promise<AiConversation> {
  return prisma.aiConversation.update({
    where: { id: conversation.id },
    data: {
      companyId: choice.companyId,
      bookChosen: true,
      awaitingBook: false,
    },
  });
}

/**
 * step11b: the files this phone / address sent just before a switch follow it to the new
 * book — from ANY book (the old code only moved files out of the general one, so "switch
 * from ABC to Personal" moved nothing). Only files still waiting for a transaction: a
 * matched file stays with its transaction. Ones that found no match in the old book are
 * read again in the new one. Returns how many moved.
 */
export async function moveRecentFiles(
  prisma: PrismaService,
  conversation: AiConversation,
  peer: string,
  companyId: number | null,
): Promise<{ moved: number; reread: number }> {
  const now = Date.now();
  let since = now - RECENT_MS;
  const asked = await prisma.aiMessage.findMany({
    where: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      createdAt: { gte: new Date(now - QUESTION_MAX_AGE_MS) },
    },
    orderBy: { id: 'desc' },
    take: 50,
    select: { createdAt: true, actions: true },
  });
  const questions = asked.filter(
    (m) =>
      Array.isArray(m.actions) &&
      (m.actions as Array<{ tool?: string }>).some((a) => a.tool === ASK_BOOK),
  );
  if (questions.length) {
    // The OLDEST open question in the window: everything sent since was undecided.
    const first = questions[questions.length - 1].createdAt.getTime();
    since = Math.min(since, first - QUESTION_SLACK_MS);
  }
  const where = {
    customerId: conversation.customerId,
    companyId: { not: companyId },
    source: conversation.channel,
    sourcePhone: peer,
    createdAt: { gte: new Date(since) },
    deletedAt: null,
    transactionId: null,
  };
  // `companyId: { not: null }` excludes NULL rows in SQL, so moving TO a business must also
  // catch the general book's files explicitly.
  const scoped =
    companyId === null
      ? where
      : {
          ...where,
          companyId: undefined,
          OR: [{ companyId: null }, { companyId: { not: companyId } }],
        };
  const reread = await prisma.transactionAttachment.updateMany({
    where: { ...scoped, status: AttachmentStatus.UNMATCHED },
    data: {
      companyId,
      status: AttachmentStatus.PENDING,
      attempts: 0,
      error: null,
    },
  });
  const rest = await prisma.transactionAttachment.updateMany({
    where: scoped,
    data: { companyId },
  });
  return { moved: reread.count + rest.count, reread: reread.count };
}
