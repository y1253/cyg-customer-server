import type { BookScope } from './scope';
import { TaxService, type ContainsRuleView, type NameGroupView, type NameView, type NamesView, type UnrecognizedView } from './tax.service';
import { SubNamesService, type SubNameView } from './sub-names.service';
export interface NamesPage {
    names: NameView[];
    nextOffset: number | null;
    total: number;
    subNames: SubNameView[];
    subDescriptions: NamesView['subDescriptions'];
    subContains: NamesView['subContains'];
    subExceptionOf: NamesView['subExceptionOf'];
    matches: Record<string, string[]>;
    head?: NamesHead;
}
export interface NamesHead {
    groups: NameGroupView[];
    counts: Record<string, number>;
    unclarified: NameView | null;
    unrecognizedCount: number;
    containsRules: ContainsRuleView[];
}
export declare class NamesQueryService {
    private readonly tax;
    private readonly subNames;
    constructor(tax: TaxService, subNames: SubNamesService);
    private load;
    page(scope: BookScope, query: {
        filter: string;
        q?: string;
    }, offset: number, limit: number): Promise<NamesPage>;
    private head;
    unrecognized(scope: BookScope, rawQ?: string): Promise<UnrecognizedView[]>;
}
