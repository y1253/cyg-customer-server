import type { BookScope } from '../bookkeeping/scope';
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
export declare class SchedulesController {
    private readonly schedules;
    constructor(schedules: SchedulesService);
    list(scope: BookScope): Promise<ScheduleView[]>;
    update(scope: BookScope, type: string, dto: UpdateScheduleDto): Promise<ScheduleView>;
    sendNow(scope: BookScope, type: string): Promise<ScheduleView>;
}
