export interface MatchCandidate {
    id: number;
    date: string | null;
    amount: number;
    name: string | null;
    description: string;
    attachedTotals: number[];
}
export interface MatchQuery {
    kind: 'RECEIPT' | 'CHECK' | 'AUDIO' | 'OTHER';
    date: string | null;
    total: number | null;
}
export declare const DAYS_BEFORE = 5;
export declare const DAYS_AFTER = 15;
export declare const TIP_SLACK = 0.2;
export declare const MAX_FOR_AI = 30;
export declare function shortlist(q: MatchQuery, rows: readonly MatchCandidate[]): MatchCandidate[];
export declare function obviousMatch(q: MatchQuery, list: readonly MatchCandidate[]): MatchCandidate | null;
export declare function chequeNumberMatch(checkNumber: string | null | undefined, total: number | null, list: readonly MatchCandidate[]): MatchCandidate | null;
export declare const looksLikeCheque: (description: string) => boolean;
export declare function chequeAmountMatch(total: number | null, list: readonly MatchCandidate[]): MatchCandidate | null;
export declare const statementImageRef: (statementId: number, page: number, index: number) => string;
export declare function statementOf(sourceRef: string | null | undefined): number | null;
