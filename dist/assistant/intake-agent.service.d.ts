import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantService } from './assistant.service';
export type IntakeChannel = 'SMS' | 'WHATSAPP';
export interface IntakeRoute {
    companyId: number | null;
    awaitingBook: boolean;
}
export interface IntakeReply {
    reply: string | null;
    fileText: boolean;
    companyId: number | null;
}
export declare class IntakeAgentService {
    private readonly prisma;
    private readonly config;
    private readonly openai;
    private readonly assistant;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService, openai: OpenAiClient, assistant: AssistantService);
    route(customerId: number, channel: IntakeChannel, peer: string): Promise<IntakeRoute>;
    agent(customerId: number, input: {
        channel: IntakeChannel;
        peer: string;
        text: string | null;
        attachmentIds: number[];
    }): Promise<IntakeReply>;
    private find;
    private books;
    private choose;
    private moveUndecided;
    private isReceiptNote;
    private received;
    private fileLabel;
}
