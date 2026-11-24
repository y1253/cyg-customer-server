export declare class NamesPageDto {
    offset?: string;
    limit?: string;
    filter?: string;
    q?: string;
}
export declare function namesPageOf(dto: NamesPageDto): {
    filter: string;
    q: string;
    offset: number;
    limit: number;
};
export declare class NamesSearchDto {
    q?: string;
}
