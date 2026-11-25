"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCode = normalizeCode;
exports.promoProblem = promoProblem;
function normalizeCode(code) {
    return code.trim().toUpperCase();
}
function promoProblem(promo, now = new Date()) {
    if (!promo || promo.deletedAt)
        return 'That promo code is not valid.';
    if (!promo.active)
        return 'That promo code is no longer active.';
    if (promo.expiresAt && promo.expiresAt.getTime() <= now.getTime())
        return 'That promo code has expired.';
    if (promo.maxUses !== null && promo.usedCount >= promo.maxUses)
        return 'That promo code has been fully used.';
    return null;
}
//# sourceMappingURL=pricing.util.js.map