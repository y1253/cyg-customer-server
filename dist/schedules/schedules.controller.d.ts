import type { BookScope } from '../bookkeeping/scope';
import { AiSchedulesService, type AiScheduleView } from './ai-schedules.service';
import { type AiScheduleChannel } from './ai-schedules.store';
import { type Frequency } from './next-run.util';
import { SchedulesService, type ScheduleView } from './schedules.service';
export declare class UpdateScheduleDto {
    enabled?: boolean;
    frequency?: Frequency;
    weekday?: number | null;
    monthDay?: number | null;
    time?: string;
    timezone?: string;
}
export declare class UpdateAiScheduleDto {
    title?: string;
    task?: string;
    active?: boolean;
    frequency?: Frequency;
    weekday?: number | null;
    monthDay?: number | null;
    time?: string;
    timezone?: string;
    date?: string | null;
    channel?: AiScheduleChannel | null;
}
export declare class SchedulesController {
    private readonly schedules;
    private readonly aiSchedules;
    constructor(schedules: SchedulesService, aiSchedules: AiSchedulesService);
    listCustom(scope: BookScope): Promise<AiScheduleView[]>;
    updateCustom(scope: BookScope, id: number, dto: UpdateAiScheduleDto): Promise<AiScheduleView>;
    removeCustom(scope: BookScope, id: number): Promise<void>;
    sendNowCustom(scope: BookScope, id: number): Promise<AiScheduleView>;
    list(scope: BookScope): Promise<ScheduleView[]>;
    update(scope: BookScope, type: string, dto: UpdateScheduleDto): Promise<ScheduleView>;
    sendNow(scope: BookScope, type: string): Promise<ScheduleView>;
}
