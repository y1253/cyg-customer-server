import { ConfigService } from '@nestjs/config';
import { type Prospect, type ProspectMessage } from '@prisma/client';
import { OpenAiClient, type AgentMessage } from '../ai/openai.client';
import { InstructionsService } from '../assistant/instructions.service';
import { StripeBillingService } from '../billing/stripe-billing.service';
import { SubscriptionService } from '../billing/subscription.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { type LockedCustomer, type PlanPricing, type ProspectChannel } from './sales-prompt';
export interface SalesReply {
    reply: string | null;
    offered: boolean;
}
export declare class SalesService {
    private readonly prisma;
    private readonly config;
    private readonly openai;
    private readonly messenger;
    private readonly instructions?;
    private readonly billing?;
    private readonly subscriptions?;
    private readonly logger;
    private readonly perPhone;
    private readonly total;
    private readonly callsPerPhone;
    private readonly callTexts;
    constructor(prisma: PrismaService, config: ConfigService, openai: OpenAiClient, messenger: CustomerMessenger, instructions?: InstructionsService | undefined, billing?: StripeBillingService | undefined, subscriptions?: SubscriptionService | undefined);
    planPricing(): Promise<PlanPricing | null>;
    private num;
    private model;
    enabled(): Promise<boolean>;
    takeCall(phone: string): boolean;
    touch(rawPhone: string, channel: ProspectChannel): Promise<Prospect>;
    save(prospectId: number, channel: ProspectChannel, role: 'USER' | 'ASSISTANT', text: string, callSid?: string | null): Promise<ProspectMessage>;
    private offeredRecently;
    private markOffered;
    prompt(p: Prospect, channel: ProspectChannel, call?: {
        language: string;
        maxMinutes: number;
    }): Promise<string>;
    private history;
    replyToText(input: {
        channel: 'SMS' | 'WHATSAPP';
        phone: string;
        text: string;
    }): Promise<SalesReply>;
    lockedPrompt(customer: LockedCustomer, channel: ProspectChannel, call?: {
        language: string;
        maxMinutes: number;
    }): Promise<string>;
    subscribeUrl(customerId: number): Promise<string | null>;
    replyToLockedCustomer(input: {
        customerId: number;
        customer: LockedCustomer;
        channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
        text: string;
        history: AgentMessage[];
    }): Promise<string | null>;
    subscribeLinkOnCall(customerId: number, phone: string, from: string | null | undefined): Promise<string>;
    offerOnCall(prospectId: number, from: string | null | undefined): Promise<string>;
    textOnCall(prospectId: number, from: string | null | undefined, callSid: string | null, rawArgs: string): Promise<string>;
    liveText(input: {
        phone: string;
        text: string;
        system?: boolean;
    }): Promise<{
        live: boolean;
    }>;
}
