"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scopeWhere = scopeWhere;
exports.scopeOf = scopeOf;
exports.generalScope = generalScope;
exports.storagePrefix = storagePrefix;
exports.bookLabel = bookLabel;
function scopeWhere(scope) {
    return { customerId: scope.customerId, companyId: scope.companyId };
}
function scopeOf(row) {
    return { customerId: row.customerId, companyId: row.companyId };
}
function generalScope(customerId) {
    return { customerId, companyId: null };
}
function storagePrefix(scope) {
    return scope.companyId === null
        ? `bookkeeping/${scope.customerId}`
        : `bookkeeping/${scope.customerId}/companies/${scope.companyId}`;
}
function bookLabel(scope) {
    return scope.companyId === null
        ? `customer ${scope.customerId}`
        : `customer ${scope.customerId} company ${scope.companyId}`;
}
//# sourceMappingURL=scope.js.map