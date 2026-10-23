"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASK_BOOK = void 0;
exports.bookOptions = bookOptions;
exports.chooseBook = chooseBook;
exports.moveRecentFiles = moveRecentFiles;
const client_1 = require("@prisma/client");
const books_1 = require("../bookkeeping/books");
exports.ASK_BOOK = 'ask_book';
const RECENT_MS = 10 * 60_000;
const QUESTION_SLACK_MS = 5 * 60_000;
const QUESTION_MAX_AGE_MS = 24 * 60 * 60_000;
async function bookOptions(prisma, customerId) {
    const books = await (0, books_1.listBooks)(prisma, customerId);
    return books.map((b) => ({ bookId: b.id, companyId: null, name: b.name }));
}
function chooseBook(prisma, conversation, choice) {
    return prisma.aiConversation.update({
        where: { id: conversation.id },
        data: {
            bookId: choice.bookId,
            companyId: choice.companyId,
            bookChosen: true,
            awaitingBook: false,
        },
    });
}
async function moveRecentFiles(prisma, conversation, peer, book) {
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
    const questions = asked.filter((m) => Array.isArray(m.actions) &&
        m.actions.some((a) => a.tool === exports.ASK_BOOK));
    if (questions.length) {
        const first = questions[questions.length - 1].createdAt.getTime();
        since = Math.min(since, first - QUESTION_SLACK_MS);
    }
    const scoped = {
        customerId: conversation.customerId,
        bookId: { not: book.bookId },
        source: conversation.channel,
        sourcePhone: peer,
        createdAt: { gte: new Date(since) },
        deletedAt: null,
        transactionId: null,
    };
    const target = { bookId: book.bookId, companyId: book.companyId };
    const reread = await prisma.transactionAttachment.updateMany({
        where: { ...scoped, status: client_1.AttachmentStatus.UNMATCHED },
        data: {
            ...target,
            status: client_1.AttachmentStatus.PENDING,
            attempts: 0,
            error: null,
        },
    });
    const rest = await prisma.transactionAttachment.updateMany({
        where: scoped,
        data: target,
    });
    return { moved: reread.count + rest.count, reread: reread.count };
}
//# sourceMappingURL=book-switch.js.map