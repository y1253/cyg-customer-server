import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import { AttachmentProcessorService } from '../bookkeeping/attachment-processor.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantService } from './assistant.service';
export type IntakeChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
export interface BookRef {
    bookId: number;
    companyId: number | null;
}
export interface IntakeRoute extends BookRef {
    awaitingBook: boolean;
}
export interface IntakeReply extends BookRef {
    reply: string | null;
    fileText: boolean;
    sent?: boolean;
}
export interface IntakeInput {
    channel: IntakeChannel;
    peer: string;
    text: string | null;
    attachmentIds: number[];
    deliverable?: boolean;
    replyFrom?: string | null;
}
export declare const NOT_DELIVERED = "Not delivered: this phone opted out of texts (STOP). Texting START re-enables replies.";
export declare const SEND_FAILED = "Not delivered: the message could not be sent.";
export declare class IntakeAgentService {
    private readonly prisma;
    private readonly config;
    private readonly openai;
    private readonly assistant;
    private readonly processor?;
    private readonly messenger?;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService, openai: OpenAiClient, assistant: AssistantService, processor?: AttachmentProcessorService | undefined, messenger?: CustomerMessenger | undefined);
    route(customerId: number, channel: IntakeChannel, peer: string, text?: string | null): Promise<IntakeRoute>;
    agent(customerId: number, input: IntakeInput): Promise<IntakeReply>;
    private sendsItself;
    private deliver;
    private mark;
    private turn;
    private undecided;
    private onlyVoiceNotes;
    private askedBook;
    private stillValid;
    private find;
    private isReceiptNote;
    private received;
}
