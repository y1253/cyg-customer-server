"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRefusal = mergeRefusal;
const NOT_MERGEABLE = new Set(['retained earnings', 'uncategorized']);
function mergeRefusal(from, into) {
    const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (same(from.name, into.name))
        return 'That is the same account.';
    for (const side of [from, into]) {
        if (NOT_MERGEABLE.has(side.name.trim().toLowerCase()))
            return `"${side.name}" cannot be merged.`;
        if (side.agency)
            return `"${side.name}" is a tax agency — tax agencies cannot be merged.`;
    }
    if (!!from.folder !== !!into.folder) {
        const [bank, other] = from.folder ? [from, into] : [into, from];
        return `"${bank.name}" has its own folder on Bank feeds and "${other.name}" does not — a bank or card account can only be merged with another one that has a folder.`;
    }
    if (from.folder && into.folder) {
        if (from.folder.kind !== into.folder.kind)
            return 'A bank account cannot be merged with a credit card.';
        const a = from.folder.currency?.toUpperCase();
        const b = into.folder.currency?.toUpperCase();
        if (a && b && a !== b)
            return `"${from.name}" and "${into.name}" are in different currencies.`;
    }
    return null;
}
//# sourceMappingURL=account-merge.util.js.map