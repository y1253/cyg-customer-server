export interface BuiltinInstruction {
    key: string;
    title: string;
    text: string;
    isStrong: boolean;
    locked: boolean;
    sortOrder: number;
    target?: string;
}
export declare const BUILTIN_INSTRUCTIONS: BuiltinInstruction[];
export interface ExistingRow {
    id: number;
    key: string;
    text: string;
    lastChangeBy: string | null;
}
export interface SyncPlan {
    create: BuiltinInstruction[];
    update: Array<{
        row: ExistingRow;
        to: BuiltinInstruction;
    }>;
}
export declare function planSync(existing: readonly ExistingRow[], builtins?: readonly BuiltinInstruction[]): SyncPlan;
