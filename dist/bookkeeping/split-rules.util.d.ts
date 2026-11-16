import { type TaxKind } from './tax.util';
export type RateMode = 'PERCENT' | 'FIXED';
export interface RuleRate {
    kind: TaxKind;
    mode: RateMode;
    rate: number;
    amount: number | null;
}
export interface SplitRule {
    id: number;
    name: string;
    category: string | null;
    rates: RuleRate[];
}
export declare function directionOf(amount: number): TaxKind | null;
export declare const ruleCategory: (rule: Pick<SplitRule, "name" | "category">) => string;
export interface RuleSplit {
    ruleId: number;
    category: string;
    amount: number;
}
export declare function ruleSplits(amount: number, rules: readonly SplitRule[]): RuleSplit[];
export declare function ratesLabel(rates: readonly RuleRate[]): string;
