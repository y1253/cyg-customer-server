import type { AiConversation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export interface CommunicationsQuery {
    channel?: string | null;
    query?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number | null;
}
export declare class CommunicationsHistory {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    otherChannels(conversation: AiConversation): Promise<string | null>;
    recentTurns(conversationId: number, take: number): Promise<string | null>;
    search(customerId: number, q: CommunicationsQuery): Promise<Record<string, unknown>>;
    private rows;
    private bookNames;
}
