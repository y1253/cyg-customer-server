"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_WHATSAPP_CHARS = exports.MAX_SMS_CHARS = void 0;
exports.waIdOf = waIdOf;
exports.asE164 = asE164;
exports.fitBody = fitBody;
exports.whatsappTextPayload = whatsappTextPayload;
exports.smsForm = smsForm;
function waIdOf(e164) {
    return e164.replace(/\D/g, '');
}
function asE164(phone) {
    const t = (phone ?? '').trim();
    return /^\+[1-9]\d{6,14}$/.test(t) ? t : null;
}
exports.MAX_SMS_CHARS = 1500;
exports.MAX_WHATSAPP_CHARS = 4096;
function fitBody(body, max) {
    const t = body.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
function whatsappTextPayload(to, body) {
    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: waIdOf(to),
        type: 'text',
        text: { preview_url: true, body: fitBody(body, exports.MAX_WHATSAPP_CHARS) },
    };
}
function smsForm(from, to, body) {
    return { From: from, To: to, Body: fitBody(body, exports.MAX_SMS_CHARS) };
}
//# sourceMappingURL=messaging.util.js.map