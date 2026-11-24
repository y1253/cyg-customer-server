"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterContains = exports.filterUnrecognized = exports.groupOfName = void 0;
exports.subsByParent = subsByParent;
exports.nameMatches = nameMatches;
exports.filterNames = filterNames;
exports.groupCounts = groupCounts;
exports.pageOfNames = pageOfNames;
exports.pickSubs = pickSubs;
const lower = (s) => s.toLowerCase();
const groupOfName = (n) => n.unclarified ? 'OTHER' : (n.group ?? n.type);
exports.groupOfName = groupOfName;
function subsByParent(subs) {
    const m = new Map();
    for (const s of subs) {
        const k = lower(s.parent);
        m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
}
function nameMatches(n, subs, view, query) {
    const q = query.q;
    if (!q)
        return true;
    return (lower(n.name).includes(q) ||
        lower(n.category).includes(q) ||
        query.hits.has(lower(n.name)) ||
        n.descriptions.some((d) => lower(d.description).includes(q)) ||
        subs.some((sub) => lower(sub.name).includes(q) ||
            (view.subDescriptions[sub.id] ?? []).some((d) => lower(d.description).includes(q))));
}
function filterNames(view, subs, query) {
    return view.names.filter((n) => !n.unclarified &&
        (query.filter === 'ALL' || (0, exports.groupOfName)(n) === query.filter) &&
        nameMatches(n, subs.get(lower(n.name)) ?? [], view, query));
}
function groupCounts(view, subs, query) {
    const counts = { ALL: 0 };
    for (const n of view.names) {
        if (!nameMatches(n, subs.get(lower(n.name)) ?? [], view, query))
            continue;
        counts.ALL++;
        if (n.unclarified)
            continue;
        const g = (0, exports.groupOfName)(n);
        counts[g] = (counts[g] ?? 0) + 1;
    }
    return counts;
}
const filterUnrecognized = (list, q) => list.filter((u) => !q ||
    lower(u.sampleDescription).includes(q) ||
    lower(u.category).includes(q));
exports.filterUnrecognized = filterUnrecognized;
const filterContains = (list, q) => list.filter((r) => !q ||
    lower(r.text).includes(q) ||
    (r.category ?? '').toLowerCase().includes(q));
exports.filterContains = filterContains;
function pageOfNames(list, offset, limit) {
    const items = list.slice(offset, offset + limit);
    const next = offset + items.length;
    return { items, nextOffset: next < list.length ? next : null };
}
function pickSubs(all, ids) {
    const out = {};
    for (const id of ids)
        if (all[id] !== undefined)
            out[id] = all[id];
    return out;
}
//# sourceMappingURL=names-query.util.js.map