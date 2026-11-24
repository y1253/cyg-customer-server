import type { ContainsRuleView, NameView, NamesView, UnrecognizedView } from './tax.service';
import type { SubNameView } from './sub-names.service';
export interface NamesQuery {
    filter: string;
    q: string;
    hits: ReadonlyMap<string, ReadonlySet<string>>;
}
export declare const groupOfName: (n: NameView) => string;
export declare function subsByParent(subs: readonly SubNameView[]): Map<string, SubNameView[]>;
export declare function nameMatches(n: NameView, subs: readonly SubNameView[], view: Pick<NamesView, 'subDescriptions'>, query: Pick<NamesQuery, 'q' | 'hits'>): boolean;
export declare function filterNames(view: Pick<NamesView, 'names' | 'subDescriptions'>, subs: ReadonlyMap<string, SubNameView[]>, query: NamesQuery): NameView[];
export declare function groupCounts(view: Pick<NamesView, 'names' | 'subDescriptions'>, subs: ReadonlyMap<string, SubNameView[]>, query: Pick<NamesQuery, 'q' | 'hits'>): Record<string, number>;
export declare const filterUnrecognized: (list: readonly UnrecognizedView[], q: string) => UnrecognizedView[];
export declare const filterContains: (list: readonly ContainsRuleView[], q: string) => ContainsRuleView[];
export declare function pageOfNames<T>(list: readonly T[], offset: number, limit: number): {
    items: T[];
    nextOffset: number | null;
};
export declare function pickSubs<T>(all: Record<number, T>, ids: readonly number[]): Record<number, T>;
