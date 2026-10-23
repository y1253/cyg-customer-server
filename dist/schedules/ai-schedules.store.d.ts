import type { AiSchedule } from '@prisma/client';
import { type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { type Frequency, type ScheduleRule } from './next-run.util';
export type AiScheduleChannel = 'EMAIL' | 'SMS' | 'CALL';
export declare const AI_SCHEDULE_CHANNELS: readonly AiScheduleChannel[];
export interface AiScheduleInput {
    title?: string;
    task?: string;
    frequency?: Frequency;
    weekday?: number | null;
    monthDay?: number | null;
    time?: string;
    timezone?: string;
    date?: string | null;
    channel?: AiScheduleChannel | null;
    active?: boolean;
}
export declare const MAX_AI_SCHEDULES = 20;
export declare const aiRuleOf: (s: AiSchedule) => ScheduleRule;
export declare class AiSchedulesStore {
    private readonly prisma;
    constructor(prisma: PrismaService);
    list(scope: BookScope): Promise<AiSchedule[]>;
    get(scope: BookScope, id: number): Promise<AiSchedule>;
    create(scope: BookScope, input: AiScheduleInput, meta: {
        createdBy: 'AI' | 'CUSTOMER';
        conversationId?: number | null;
    }): Promise<AiSchedule>;
    update(scope: BookScope, id: number, input: AiScheduleInput): Promise<AiSchedule>;
    remove(scope: BookScope, id: number): Promise<AiSchedule>;
    describe(s: AiSchedule): string;
    private firstRun;
    private rule;
    private channel;
    private bookZone;
}
