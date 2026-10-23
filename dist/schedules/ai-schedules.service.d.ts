import { OnModuleInit } from '@nestjs/common';
import { AssistantService } from '../assistant/assistant.service';
import { type BookScope } from '../bookkeeping/scope';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceCallsService } from '../voice/voice-calls.service';
import { AiSchedulesStore, type AiScheduleChannel, type AiScheduleInput } from './ai-schedules.store';
import { type Frequency } from './next-run.util';
import { SchedulesService, type ScheduleRunView } from './schedules.service';
export interface AiScheduleView {
    id: number;
    title: string;
    task: string;
    frequency: Frequency;
    weekday: number | null;
    monthDay: number | null;
    time: string;
    timezone: string;
    runDate: string | null;
    description: string;
    channel: AiScheduleChannel | null;
    active: boolean;
    createdBy: 'AI' | 'CUSTOMER';
    nextRunAt: string | null;
    lastRunAt: string | null;
    createdAt: string;
    delivery: {
        channel: AiScheduleChannel | null;
        to: string | null;
    };
    runs: ScheduleRunView[];
}
export declare class AiSchedulesService implements OnModuleInit {
    private readonly prisma;
    private readonly store;
    private readonly schedules;
    private readonly assistant;
    private readonly messenger;
    private readonly voice;
    private readonly logger;
    private ticking;
    constructor(prisma: PrismaService, store: AiSchedulesStore, schedules: SchedulesService, assistant: AssistantService, messenger: CustomerMessenger, voice: VoiceCallsService);
    onModuleInit(): void;
    private callMissed;
    list(scope: BookScope): Promise<AiScheduleView[]>;
    update(scope: BookScope, id: number, input: AiScheduleInput): Promise<AiScheduleView>;
    remove(scope: BookScope, id: number): Promise<void>;
    sendNow(scope: BookScope, id: number): Promise<AiScheduleView>;
    tick(): Promise<void>;
    private run;
    private email;
    private delivery;
    private view;
}
