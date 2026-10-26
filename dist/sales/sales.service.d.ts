import { ConfigService } from '@nestjs/config';
import { type Prospect, type ProspectMessage } from '@prisma/client';
import { OpenAiClient } from '../ai/openai.client';
import { InstructionsService } from '../assistant/instructions.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { type ProspectChannel } from './sales-prompt';
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
    private readonly logger;
    private readonly perPhone;
    private readonly total;
    private readonly callsPerPhone;
    constructor(prisma: PrismaService, config: ConfigService, openai: OpenAiClient, messenger: CustomerMessenger, instructions?: InstructionsService | undefined);
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
    offerOnCall(prospectId: number, from: string | null | undefined): Promise<string>;
}
