import { type AiConversation } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { BookOption } from './assistant-prompt';
export declare const ASK_BOOK = "ask_book";
export declare function bookOptions(prisma: PrismaService, customerId: number): Promise<BookOption[]>;
export declare function chooseBook(prisma: PrismaService, conversation: AiConversation, choice: BookOption): Promise<AiConversation>;
export declare function moveRecentFiles(prisma: PrismaService, conversation: AiConversation, peer: string, companyId: number | null): Promise<{
    moved: number;
    reread: number;
}>;
