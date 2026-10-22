import { ConfigService } from '@nestjs/config';
import { type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { BankFeedSyncService, type ItemStatus } from './bank-feed-sync.service';
import { PlaidClient } from './plaid.client';
export interface BankConnectionView {
    id: number;
    institutionName: string | null;
    status: ItemStatus;
    error: string | null;
    historyDone: boolean;
    lastSyncAt: Date | null;
    createdAt: Date;
    setupAt: Date | null;
    syncing: boolean;
    refreshNote?: string | null;
    newAccounts: boolean;
    earliestDate: string;
    accounts: Array<{
        id: number;
        name: string;
        mask: string | null;
        kind: string;
        accountName: string;
        currency: string | null;
        currentBalance: number | null;
        startDate: string | null;
    }>;
}
export declare class BankFeedsService {
    private readonly prisma;
    private readonly plaid;
    private readonly sync;
    private readonly config;
    private readonly logger;
    private readonly keys;
    constructor(prisma: PrismaService, plaid: PlaidClient, sync: BankFeedSyncService, config: ConfigService);
    private get key();
    get enabled(): boolean;
    list(scope: BookScope): Promise<BankConnectionView[]>;
    private owned;
    private view;
    linkToken(scope: BookScope, itemId?: number, chooseAccounts?: boolean): Promise<{
        linkToken: string;
    }>;
    exchange(scope: BookScope, publicToken: string): Promise<BankConnectionView>;
    reconnected(scope: BookScope, id: number): Promise<BankConnectionView>;
    refresh(scope: BookScope, id: number): Promise<BankConnectionView>;
    setStartDates(scope: BookScope, id: number, accounts: ReadonlyArray<{
        id: number;
        startDate?: string | null;
    }>): Promise<BankConnectionView>;
    remove(scope: BookScope, id: number): Promise<void>;
    private call;
    verify(token: string | undefined, rawBody: Buffer | undefined): Promise<string | null>;
    handle(body: {
        webhook_type?: string;
        webhook_code?: string;
        item_id?: string;
        historical_update_complete?: boolean;
        error?: {
            error_code?: string;
            display_message?: string | null;
            error_message?: string;
        } | null;
    }): Promise<void>;
}
