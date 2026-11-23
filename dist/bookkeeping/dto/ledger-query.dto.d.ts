import type { LedgerQuery } from '../ledger-query.util';
export declare class LedgerQueryDto {
    offset?: string;
    limit?: string;
    q?: string;
    statementIds?: string;
    account?: string;
    focusId?: string;
    name?: string;
    description?: string;
    subNameId?: string;
    from?: string;
    to?: string;
    filters?: string;
    sort?: string;
    folded?: string;
    nearAmount?: string;
    nearDate?: string;
    near?: string;
}
export declare function ledgerQueryOf(dto: LedgerQueryDto): {
    query: LedgerQuery;
    offset: number;
    limit: number;
};
