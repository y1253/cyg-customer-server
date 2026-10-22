import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookScheduleType } from '@prisma/client';
import { AssistantService } from '../assistant/assistant.service';
import { FileLinkService } from '../bookkeeping/file-links';
import { ReportsService } from '../bookkeeping/reports.service';
import { type BookScope } from '../bookkeeping/scope';
import { TaxService } from '../bookkeeping/tax.service';
import { MailService } from '../mail/mail.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceCallsService } from '../voice/voice-calls.service';
import { type Frequency } from './next-run.util';
import { type AccountStatus } from './schedule-messages.util';
export type DeliveryChannel = 'EMAIL' | 'SMS' | 'CALL';
export interface ScheduleRunView {
    at: string;
    channel: string;
    ok: boolean;
    error: string | null;
    manual: boolean;
    text: string | null;
}
export interface ScheduleView {
    type: BookScheduleType;
    enabled: boolean;
    frequency: Frequency;
    weekday: number | null;
    monthDay: number | null;
    time: string;
    timezone: string;
    description: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
    delivery: {
        channel: DeliveryChannel | null;
        to: string | null;
        preferred: string | null;
    };
    runs: ScheduleRunView[];
}
export interface ScheduleInput {
    enabled?: boolean;
    frequency?: Frequency;
    weekday?: number | null;
    monthDay?: number | null;
    time?: string;
    timezone?: string;
}
export declare class SchedulesService implements OnModuleInit {
    private readonly prisma;
    private readonly config;
    private readonly mail;
    private readonly messenger;
    private readonly links;
    private readonly reports;
    private readonly tax;
    private readonly assistant;
    private readonly voice;
    private readonly logger;
    private ticking;
    constructor(prisma: PrismaService, config: ConfigService, mail: MailService, messenger: CustomerMessenger, links: FileLinkService, reports: ReportsService, tax: TaxService, assistant: AssistantService, voice: VoiceCallsService);
    onModuleInit(): void;
    private callMissed;
    list(scope: BookScope): Promise<ScheduleView[]>;
    update(scope: BookScope, type: BookScheduleType, input: ScheduleInput): Promise<ScheduleView>;
    sendNow(scope: BookScope, type: BookScheduleType): Promise<ScheduleView>;
    tick(): Promise<void>;
    private run;
    private compose;
    email(to: string, m: {
        subject: string;
        text: string;
        html: string;
        attachments: Array<{
            filename: string;
            content: Buffer;
            contentType: string;
        }>;
    }): Promise<string | null>;
    status(scope: BookScope, since: Date | null): Promise<AccountStatus>;
    private ensure;
    private view;
    delivery(customerId: number, noCall?: boolean): Promise<ScheduleView['delivery']>;
    liveBook(scope: BookScope): Promise<{
        customerName: string;
        email: string | null;
        book: string;
    } | null>;
    private dashboardLink;
    logText(scope: BookScope, phone: string, text: string): Promise<void>;
    static typeOf(raw: string): BookScheduleType;
}
