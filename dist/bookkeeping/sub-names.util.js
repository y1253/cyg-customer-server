"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitLabelOf = exports.splitSubNameOf = exports.subNameOf = void 0;
exports.parentSubName = parentSubName;
exports.subNameFiling = subNameFiling;
const subNameOf = (parent, category) => `${parent} - ${category}`.slice(0, 191);
exports.subNameOf = subNameOf;
const splitSubNameOf = (parent, category, label) => label.trim()
    ? `${parent} - ${category} - ${label.trim()}`.slice(0, 191)
    : (0, exports.subNameOf)(parent, category);
exports.splitSubNameOf = splitSubNameOf;
const splitLabelOf = (name, parent, category) => {
    const head = `${parent} - ${category} - `;
    return name.toLowerCase().startsWith(head.toLowerCase())
        ? name.slice(head.length)
        : category;
};
exports.splitLabelOf = splitLabelOf;
function parentSubName(p) {
    const want = (p.hasSplits || p.nameHasSubs) && p.name
        ? { parent: p.name, category: p.category }
        : p.fromRule
            ? p.current
            : null;
    const same = want === null
        ? p.current === null
        : p.current !== null &&
            p.current.parent.toLowerCase() === want.parent.toLowerCase() &&
            p.current.category === want.category;
    return { want, change: !same };
}
function subNameFiling(rows, wrappers, subs) {
    const out = [];
    for (const r of rows) {
        const name = r.name?.trim();
        const nameId = name
            ? wrappers.get(name.replace(/\s+/g, ' ').toLowerCase())
            : undefined;
        if (!name || nameId === undefined)
            continue;
        const sub = r.subNameId !== null ? subs.get(r.subNameId) : undefined;
        if (sub && sub.nameId === nameId && sub.category === r.category)
            continue;
        out.push({ id: r.id, name, category: r.category });
    }
    return out;
}
//# sourceMappingURL=sub-names.util.js.map