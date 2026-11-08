"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRefusal = mergeRefusal;
exports.renameRefusal = renameRefusal;
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
const NOT_RENAMABLE = new Set([
    ...NOT_MERGEABLE,
    "owner's loan",
    'exchange gain or loss',
]);
function renameRefusal(from, to, taken) {
    const name = to.trim();
    if (!name)
        return 'Enter the new name.';
    if (name === from.name.trim())
        return 'That is already its name.';
    if (NOT_RENAMABLE.has(from.name.trim().toLowerCase()))
        return `"${from.name}" cannot be renamed.`;
    if (from.agency)
        return `"${from.name}" is a tax agency — rename it in your tax settings.`;
    if (NOT_RENAMABLE.has(name.toLowerCase()))
        return `"${name}" is kept for the books' own use — pick another name.`;
    if (taken)
        return `You already have an account called "${name}". Drag one onto the other to merge them instead.`;
    return null;
}
//# sourceMappingURL=account-merge.util.js.map