"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chequeNumberOf = chequeNumberOf;
exports.dropChequeCaptions = dropChequeCaptions;
function chequeNumberOf(description) {
    const m = /(?<![\p{L}\p{N}])(?:cheque|check|chq|chk)\.?\s*(?:no\.?|n°|#)?\s*:?\s*(\d{1,12})/iu.exec(description);
    if (!m)
        return null;
    const n = m[1].replace(/^0+/, '');
    return n || null;
}
function dropChequeCaptions(pages) {
    const seen = new Set();
    let dropped = 0;
    const out = pages.map((p) => {
        const keep = [];
        for (const t of p.transactions) {
            const n = chequeNumberOf(t.description ?? '');
            const key = n && Number.isFinite(t.amount)
                ? `${n}:${Math.abs(Math.round(t.amount * 100))}`
                : null;
            if (key && p.hasItemImages && seen.has(key)) {
                dropped++;
                continue;
            }
            if (key)
                seen.add(key);
            keep.push(t);
        }
        return keep.length === p.transactions.length
            ? p
            : { ...p, transactions: keep };
    });
    return { pages: out, dropped };
}
//# sourceMappingURL=cheque-caption.util.js.map