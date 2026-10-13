"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toE164 = toE164;
function toE164(input) {
    if (!input)
        return null;
    const trimmed = input.trim();
    if (/^\+[1-9]\d{7,14}$/.test(trimmed))
        return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 10)
        return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1'))
        return `+${digits}`;
    return null;
}
//# sourceMappingURL=phone-number.util.js.map