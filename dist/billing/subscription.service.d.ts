import { HttpException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CustomerSubscription, SubscriptionPlan } from '@prisma/client';
import type { BookScope } from '../bookkeeping/scope';
import { MailService } from '../mail/mail.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { type Access, type TrialItem } from './entitlement.util';
export interface Allowance {
    used: number;
    limit: number;
}
export interface AccessState extends Access {
    trial: {
        transactions: Allowance;
        texts: Allowance;
        callMinutes: Allowance;
        usedUp: TrialItem[];
    } | null;
    monthly: {
        month: string;
        used: number;
        limit: number;
        remaining: number;
        warn: boolean;
        reached: boolean;
        resetsAt: string;
    } | null;
    lockedText: string | null;
}
export declare class SubscriptionRequiredException extends HttpException {
    constructor(reason: string, message: string);
}
export declare class TransactionLimitException extends HttpException {
    constructor(state: AccessState);
}
export declare class SubscriptionService implements OnModuleInit {
    private readonly prisma;
    private readonly config;
    private readonly messenger;
    private readonly mail;
    private readonly logger;
    private planCache;
    private readonly cache;
    constructor(prisma: PrismaService, config: ConfigService, messenger: CustomerMessenger, mail: MailService);
    onModuleInit(): void;
    forget(customerId: number): void;
    plan(): Promise<SubscriptionPlan>;
    row(customerId: number): Promise<CustomerSubscription>;
    state(customerId: number): Promise<AccessState>;
    private compute;
    private trialUsage;
    private monthUsed;
    assertActive(customerId: number): Promise<AccessState>;
    remainingTransactions(customerId: number): Promise<number>;
    assertCanAddTransactions(customerId: number): Promise<void>;
    callMinutesLeft(customerId: number): Promise<number | null>;
    private allowText;
    recordUsage(scope: BookScope, source: 'STATEMENT' | 'BANK_FEED', transactions: number, ref: {
        statementId?: number;
        plaidItemId?: number;
    }): Promise<void>;
    statementCounted(statementId: number): Promise<boolean>;
    notices(customerId: number): Promise<void>;
    private notify;
    baseUrl(): string;
    priceText: (() => Promise<string>) | null;
    private priceLabel;
}
