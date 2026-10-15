"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEmail = normalizeEmail;
exports.planBackfill = planBackfill;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(raw) {
    const e = raw?.trim().toLowerCase() ?? '';
    return EMAIL.test(e) ? e : null;
}
function planBackfill(companies, existing) {
    const created = new Map();
    const linked = new Map();
    const skipped = [];
    for (const c of companies) {
        const email = normalizeEmail(c.privateEmail);
        if (!email) {
            skipped.push({
                companyId: c.id,
                businessName: c.businessName,
                reason: c.privateEmail?.trim()
                    ? `not an email: "${c.privateEmail}"`
                    : 'no owner email',
            });
            continue;
        }
        const customerId = existing.get(email);
        if (customerId !== undefined) {
            const row = linked.get(email) ?? { customerId, email, companyIds: [] };
            row.companyIds.push(c.id);
            linked.set(email, row);
            continue;
        }
        const row = created.get(email) ?? {
            email,
            name: c.personalName?.trim() || c.businessName,
            companyIds: [],
        };
        row.companyIds.push(c.id);
        created.set(email, row);
    }
    return {
        create: [...created.values()],
        link: [...linked.values()],
        skipped,
    };
}
//# sourceMappingURL=company-backfill.util.js.map