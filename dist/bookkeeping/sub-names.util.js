"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subNameOf = void 0;
exports.parentSubName = parentSubName;
const subNameOf = (parent, category) => `${parent} - ${category}`.slice(0, 191);
exports.subNameOf = subNameOf;
function parentSubName(p) {
    const want = p.hasSubSplits && p.name
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
//# sourceMappingURL=sub-names.util.js.map