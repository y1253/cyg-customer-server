"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relinkPlan = relinkPlan;
function relinkPlan(linked, fresh) {
    const out = new Map();
    const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const pick = (a, sameText) => {
        const hits = fresh.filter((r) => r.amountCents === a.amountCents &&
            r.day === a.day &&
            (!sameText || norm(r.description) === norm(a.description)));
        if (sameText)
            return hits.length ? hits[0].id : null;
        return hits.length === 1 ? hits[0].id : null;
    };
    for (const a of linked) {
        const id = pick(a, true) ?? pick(a, false);
        if (id !== null)
            out.set(a.attachmentId, id);
    }
    return out;
}
//# sourceMappingURL=reread-relink.util.js.map