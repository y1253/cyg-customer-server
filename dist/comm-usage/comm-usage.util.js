"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICE_FIELDS = void 0;
exports.pricesOf = pricesOf;
exports.segmentsOf = segmentsOf;
exports.billedMinutes = billedMinutes;
exports.messageCost = messageCost;
exports.callCost = callCost;
exports.billedPrice = billedPrice;
exports.checkPagePrices = checkPagePrices;
exports.samePrices = samePrices;
exports.pageText = pageText;
exports.PRICE_FIELDS = [
    'smsOutPerSegment',
    'smsInPerSegment',
    'mmsOut',
    'mmsIn',
    'voiceOutPerMin',
    'voiceInPerMin',
    'recordingPerMin',
    'whatsappOut',
    'whatsappIn',
];
function pricesOf(row) {
    const out = {};
    for (const k of exports.PRICE_FIELDS) {
        const v = row[k];
        out[k] = v === null || v === undefined ? null : Number(v);
    }
    return out;
}
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';
function segmentsOf(body) {
    if (!body)
        return 1;
    let gsm = true;
    let units = 0;
    for (const ch of body) {
        if (GSM7.includes(ch))
            units += 1;
        else if (GSM7_EXT.includes(ch))
            units += 2;
        else {
            gsm = false;
            break;
        }
    }
    if (gsm)
        return units <= 160 ? 1 : Math.ceil(units / 153);
    const len = body.length;
    return len <= 70 ? 1 : Math.ceil(len / 67);
}
function billedMinutes(durationSec) {
    return durationSec > 0 ? Math.ceil(durationSec / 60) : 0;
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;
function messageCost(p, m) {
    if (m.channel === 'WHATSAPP') {
        const price = m.direction === 'OUT' ? p.whatsappOut : p.whatsappIn;
        return price === null ? null : round6(price);
    }
    if (m.media > 0) {
        const price = m.direction === 'OUT' ? p.mmsOut : p.mmsIn;
        return price === null ? null : round6(price);
    }
    const price = m.direction === 'OUT' ? p.smsOutPerSegment : p.smsInPerSegment;
    return price === null ? null : round6(price * Math.max(1, m.segments));
}
function callCost(p, c) {
    const perMin = c.direction === 'OUT' ? p.voiceOutPerMin : p.voiceInPerMin;
    if (perMin === null)
        return null;
    const minutes = billedMinutes(c.durationSec);
    const recording = billedMinutes(c.recordingSec) * (p.recordingPerMin ?? 0);
    return round6(minutes * perMin + recording);
}
function billedPrice(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? round6(Math.abs(n)) : null;
}
function checkPagePrices(read, current) {
    const out = { ...current };
    let found = 0;
    for (const k of exports.PRICE_FIELDS) {
        const v = read[k];
        if (v === null || v === undefined)
            continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
            return {
                ok: false,
                reason: `${k} = ${String(v)} is not a believable price`,
            };
        }
        const old = current[k];
        if (old !== null && old > 0 && (v > old * 3 || v < old / 3)) {
            return {
                ok: false,
                reason: `${k} read as ${v}, too far from the current ${old}`,
            };
        }
        out[k] = round6(v);
        found++;
    }
    if (!found)
        return { ok: false, reason: 'no price found on the page' };
    return { ok: true, prices: out };
}
function samePrices(a, b) {
    return exports.PRICE_FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
function pageText(html, max = 60_000) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#36;|&dollar;/g, '$')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}
//# sourceMappingURL=comm-usage.util.js.map