"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeMailLimiter = exports.CODE_MAIL_PER_HOUR_DEFAULT = exports.CODE_MAIL_DAY_MS = exports.CODE_MAIL_PER_ADDRESS = exports.CODE_MAIL_GAP_MS = void 0;
exports.maskEmail = maskEmail;
exports.CODE_MAIL_GAP_MS = 60_000;
exports.CODE_MAIL_PER_ADDRESS = 5;
exports.CODE_MAIL_DAY_MS = 24 * 60 * 60_000;
exports.CODE_MAIL_PER_HOUR_DEFAULT = 30;
const HOUR_MS = 60 * 60_000;
class CodeMailLimiter {
    perHour;
    now;
    byAddress = new Map();
    global = [];
    constructor(perHour = exports.CODE_MAIL_PER_HOUR_DEFAULT, now = () => Date.now()) {
        this.perHour = perHour;
        this.now = now;
    }
    check(email) {
        const t = this.now();
        const sent = this.recent(email, t);
        if (sent.length >= exports.CODE_MAIL_PER_ADDRESS ||
            (sent.length > 0 && t - sent[sent.length - 1] < exports.CODE_MAIL_GAP_MS)) {
            return 'address';
        }
        this.global = this.global.filter((s) => t - s < HOUR_MS);
        if (this.global.length >= this.perHour)
            return 'global';
        return 'ok';
    }
    record(email) {
        const t = this.now();
        this.byAddress.set(email, [...this.recent(email, t), t]);
        this.global.push(t);
    }
    recent(email, t) {
        const sent = (this.byAddress.get(email) ?? []).filter((s) => t - s < exports.CODE_MAIL_DAY_MS);
        if (sent.length)
            this.byAddress.set(email, sent);
        else
            this.byAddress.delete(email);
        return sent;
    }
}
exports.CodeMailLimiter = CodeMailLimiter;
function maskEmail(email) {
    const [local, domain] = email.split('@');
    if (!domain)
        return '***';
    return `${local.slice(0, 1)}***@${domain}`;
}
//# sourceMappingURL=code-mail-limiter.js.map