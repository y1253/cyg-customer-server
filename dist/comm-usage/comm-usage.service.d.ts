import type { CommProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type CommChannel, type CommDirection, type CommPurpose } from './comm-usage.util';
export type ProviderName = 'SIGNALWIRE' | 'WHATSAPP';
export interface CommWho {
    customerId?: number | null;
    bookId?: number | null;
    companyId?: number | null;
}
export declare class CommUsageService {
    private readonly prisma;
    private readonly logger;
    private readonly providers;
    constructor(prisma: PrismaService);
    clearCache(): void;
    provider(name: ProviderName): Promise<CommProvider | null>;
    recordMessage(m: CommWho & {
        channel: CommChannel;
        direction: CommDirection;
        purpose: CommPurpose;
        providerSid?: string | null;
        from?: string | null;
        to?: string | null;
        segments?: number | null;
        body?: string | null;
        media?: number;
        status?: string | null;
    }): void;
    private saveMessage;
    callStarted(c: CommWho & {
        callSid: string;
        aiCallId?: number | null;
        direction: CommDirection;
        purpose: string;
        from?: string | null;
        to?: string | null;
    }): void;
    callEnded(callSid: string, e: {
        durationSec: number;
        recorded?: boolean;
    }): void;
}
