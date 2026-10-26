import { PrismaService } from '../prisma/prisma.service';
import { type CommChannel, type CommItem } from './communications.util';
import { type BookScope } from './scope';
export interface ChannelSummary {
    channel: CommChannel;
    lastAt: string | null;
    preview: string | null;
    count: number;
}
export interface CommPage {
    items: CommItem[];
    nextBefore: string | null;
}
export declare class CommunicationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    channels(scope: BookScope): Promise<ChannelSummary[]>;
    page(scope: BookScope, channel: CommChannel, before: Date | null, limit?: number): Promise<CommPage>;
    private count;
    private spansAround;
    private transcriptCount;
    private referencedIds;
}
