export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE';
export declare const FREQUENCIES: readonly Frequency[];
export declare const AI_FREQUENCIES: readonly Frequency[];
export interface ScheduleRule {
    frequency: Frequency;
    weekday: number | null;
    monthDay: number | null;
    time: string;
    timezone: string;
    date?: string | null;
}
export declare function parseDate(date: string | null | undefined): [number, number, number] | null;
export declare const DEFAULT_TIMEZONE = "America/Toronto";
export declare function safeZone(tz: string | null | undefined): string;
export declare function parseTime(time: string): [number, number] | null;
export declare function wallClock(at: Date, tz: string): {
    y: number;
    m: number;
    d: number;
    h: number;
    min: number;
    dow: number;
};
export declare function zonedInstant(y: number, m: number, d: number, h: number, min: number, tz: string): Date;
export declare function nextRun(rule: ScheduleRule, after: Date): Date | null;
export declare function previousMonth(at: Date, tz: string): {
    from: string;
    to: string;
    label: string;
};
export declare function describeRule(rule: ScheduleRule): string;
