"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameKeyOf = void 0;
exports.attachmentName = attachmentName;
exports.fileBucket = fileBucket;
const reports_util_1 = require("./reports.util");
const clean = (s) => {
    const t = s?.replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 191) : null;
};
function attachmentName(a) {
    const own = clean(a.nameOverride);
    if (own)
        return own;
    if (a.transaction)
        return clean(a.transaction.name) ?? reports_util_1.UNCLARIFIED_NAME;
    const r = a.reading;
    return clean(r?.vendor) ?? clean(r?.payee) ?? clean(r?.party) ?? null;
}
const nameKeyOf = (name) => name.replace(/\s+/g, ' ').trim().toLowerCase();
exports.nameKeyOf = nameKeyOf;
function fileBucket(status, onTransaction, unsorted) {
    if (status === 'PENDING' || status === 'PROCESSING')
        return 'READING';
    if (onTransaction)
        return 'RELATED';
    if (unsorted)
        return 'ERROR';
    if (status === 'DOCUMENT')
        return 'DOCUMENT';
    return 'ERROR';
}
//# sourceMappingURL=attachment-name.util.js.map