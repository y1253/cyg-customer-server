export interface BookScope {
    customerId: number;
    bookId: number;
    companyId: number | null;
}
export declare function scopeWhere(scope: BookScope): {
    customerId: number;
    bookId: number;
    companyId: number | null;
};
export declare function scopeOf(row: {
    customerId: number;
    bookId: number;
    companyId: number | null;
}): BookScope;
export declare function bookScope(book: {
    id: number;
    customerId: number;
    companyId: number | null;
}): BookScope;
export declare function storagePrefix(scope: BookScope): string;
export declare function bookLabel(scope: BookScope): string;
