"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRIPE_MIN_CENTS = void 0;
exports.normalizeCode = normalizeCode;
exports.promoProblem = promoProblem;
exports.priceFor = priceFor;
exports.STRIPE_MIN_CENTS = 50;
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
function priceFor(listCents, promo) {
    let cents = Math.max(0, Math.round(listCents));
    if (promo?.kind === 'FIXED_PRICE')
        cents = Math.max(0, Math.round(promo.value));
    if (promo?.kind === 'PERCENT_OFF') {
        const pct = Math.min(100, Math.max(0, promo.value));
        cents = Math.round((cents * (100 - pct)) / 100);
    }
    return cents > 0 && cents < exports.STRIPE_MIN_CENTS ? exports.STRIPE_MIN_CENTS : cents;
}
//# sourceMappingURL=pricing.util.js.map