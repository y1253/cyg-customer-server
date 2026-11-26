"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeNamesAndQuickBooks = mergeNamesAndQuickBooks;
exports.staffNames = staffNames;
async function mergeNamesAndQuickBooks(subNames, qbo, scope, input) {
    const from = input.from ?? null;
    const pushedAs = from ? await qbo.pushedPayee(scope, from) : null;
    const into = from && input.into == null && input.intoSubNameId != null
        ? await subNames.parentOfSubName(scope, input.intoSubNameId)
        : (input.into ?? null);
    await subNames.merge(scope, input);
    if (from)
        qbo.mergePayee(scope, pushedAs, into);
    else
        qbo.syncSoon(scope.bookId);
}
async function staffNames(tax, subNames, scope) {
    const [view, subs] = await Promise.all([
        tax.names(scope),
        subNames.list(scope),
    ]);
    const subsOf = new Map();
    for (const s of subs) {
        const key = s.parent.toLowerCase();
        const list = subsOf.get(key) ?? [];
        list.push({
            id: s.id,
            name: s.name,
            category: s.category,
            rows: s.rows,
            total: s.total,
        });
        subsOf.set(key, list);
    }
    return view.names.map((n) => {
        const own = subsOf.get(n.name.toLowerCase()) ?? [];
        return {
            name: n.name,
            category: n.category,
            rows: n.rows,
            total: n.total,
            group: n.group,
            wrapper: own.length > 0,
            unclarified: n.unclarified === true,
            subNames: own,
        };
    });
}
//# sourceMappingURL=merge-names.js.map