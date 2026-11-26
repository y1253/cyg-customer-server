import type { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
import type { BookScope } from './scope';
import type { SubNamesService } from './sub-names.service';
import type { TaxService } from './tax.service';
export interface MergeNamesInput {
    from?: string;
    fromSubNameId?: number;
    into?: string;
    intoSubNameId?: number;
}
export declare function mergeNamesAndQuickBooks(subNames: SubNamesService, qbo: QuickBooksSyncService, scope: BookScope, input: MergeNamesInput): Promise<void>;
export interface StaffNameView {
    name: string;
    category: string;
    rows: number;
    total: number;
    group: string;
    wrapper: boolean;
    unclarified: boolean;
    subNames: Array<{
        id: number;
        name: string;
        category: string;
        rows: number;
        total: number;
    }>;
}
export declare function staffNames(tax: TaxService, subNames: SubNamesService, scope: BookScope): Promise<StaffNameView[]>;
