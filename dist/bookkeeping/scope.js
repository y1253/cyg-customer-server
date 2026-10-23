"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scopeWhere = scopeWhere;
exports.scopeOf = scopeOf;
exports.bookScope = bookScope;
exports.storagePrefix = storagePrefix;
exports.bookLabel = bookLabel;
function scopeWhere(scope) {
    return {
        customerId: scope.customerId,
        bookId: scope.bookId,
        companyId: scope.companyId,
    };
}
function scopeOf(row) {
    return {
        customerId: row.customerId,
        bookId: row.bookId,
        companyId: row.companyId,
    };
}
function bookScope(book) {
    return {
        customerId: book.customerId,
        bookId: book.id,
        companyId: book.companyId,
    };
}
function storagePrefix(scope) {
    return `bookkeeping/${scope.customerId}/books/${scope.bookId}`;
}
function bookLabel(scope) {
    return `customer ${scope.customerId} book ${scope.bookId}`;
}
//# sourceMappingURL=scope.js.map