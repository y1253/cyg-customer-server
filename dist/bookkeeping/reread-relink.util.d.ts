export interface LinkedRow {
    attachmentId: number;
    amountCents: number;
    day: string | null;
    description: string;
}
export interface FreshRow {
    id: number;
    amountCents: number;
    day: string | null;
    description: string;
}
export declare function relinkPlan(linked: readonly LinkedRow[], fresh: readonly FreshRow[]): Map<number, number>;
