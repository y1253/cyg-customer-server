"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUsage = parseUsage;
exports.isEmptyUsage = isEmptyUsage;
exports.costOf = costOf;
exports.pricesFromLiteLlm = pricesFromLiteLlm;
exports.samePrices = samePrices;
const n = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
const obj = (v) => (v && typeof v === 'object' ? v : {});
function parseUsage(kind, raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const u = raw;
    const zero = {
        input: 0,
        cached: 0,
        output: 0,
        audioIn: 0,
        audioOut: 0,
        audioSeconds: 0,
    };
    if (kind === 'chat') {
        const inD = obj(u.prompt_tokens_details);
        const outD = obj(u.completion_tokens_details);
        const audioIn = n(inD.audio_tokens);
        const audioOut = n(outD.audio_tokens);
        return {
            ...zero,
            input: Math.max(0, n(u.prompt_tokens) - audioIn),
            cached: n(inD.cached_tokens),
            output: Math.max(0, n(u.completion_tokens) - audioOut),
            audioIn,
            audioOut,
        };
    }
    if (kind === 'responses') {
        return {
            ...zero,
            input: n(u.input_tokens),
            cached: n(obj(u.input_tokens_details).cached_tokens),
            output: n(u.output_tokens),
        };
    }
    if (kind === 'transcribe') {
        if (u.type === 'duration')
            return { ...zero, audioSeconds: n(u.seconds) };
        const d = obj(u.input_token_details);
        const audioIn = d.audio_tokens !== undefined ? n(d.audio_tokens) : n(u.input_tokens);
        return {
            ...zero,
            input: n(d.text_tokens),
            audioIn,
            output: n(u.output_tokens),
        };
    }
    const inD = obj(u.input_token_details);
    const outD = obj(u.output_token_details);
    return {
        ...zero,
        input: n(inD.text_tokens),
        cached: Math.min(n(inD.text_tokens), n(obj(inD.cached_tokens_details).text_tokens)),
        output: n(outD.text_tokens),
        audioIn: n(inD.audio_tokens),
        audioOut: n(outD.audio_tokens),
    };
}
function isEmptyUsage(u) {
    return !(u.input || u.output || u.audioIn || u.audioOut || u.audioSeconds);
}
function costOf(p, u) {
    if (p.inputPerMTok === null &&
        p.outputPerMTok === null &&
        p.audioInputPerMTok === null &&
        p.perMinute === null) {
        return null;
    }
    const inP = p.inputPerMTok ?? 0;
    const outP = p.outputPerMTok ?? 0;
    const cached = Math.min(u.cached, u.input);
    const usd = ((u.input - cached) * inP +
        cached * (p.cachedInputPerMTok ?? inP) +
        u.output * outP +
        u.audioIn * (p.audioInputPerMTok ?? inP) +
        u.audioOut * (p.audioOutputPerMTok ?? outP)) /
        1_000_000 +
        (u.audioSeconds / 60) * (p.perMinute ?? 0);
    return Math.round(usd * 1_000_000) / 1_000_000;
}
const perM = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.round(v * 1_000_000 * 10_000) / 10_000
    : null;
function pricesFromLiteLlm(list, model) {
    const name = model.trim();
    const undated = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');
    const candidates = [name, `openai/${name}`, undated, `openai/${undated}`];
    for (const key of candidates) {
        const e = list[key];
        if (!e || typeof e !== 'object')
            continue;
        const prices = {
            inputPerMTok: perM(e.input_cost_per_token),
            cachedInputPerMTok: perM(e.cache_read_input_token_cost),
            outputPerMTok: perM(e.output_cost_per_token),
            audioInputPerMTok: perM(e.input_cost_per_audio_token),
            audioOutputPerMTok: perM(e.output_cost_per_audio_token),
            perMinute: typeof e.input_cost_per_second === 'number'
                ? Math.round(e.input_cost_per_second * 60 * 1_000_000) / 1_000_000
                : null,
        };
        if (prices.inputPerMTok === null &&
            prices.outputPerMTok === null &&
            prices.perMinute === null) {
            continue;
        }
        return prices;
    }
    return null;
}
function samePrices(a, b) {
    const keys = [
        'inputPerMTok',
        'cachedInputPerMTok',
        'outputPerMTok',
        'audioInputPerMTok',
        'audioOutputPerMTok',
        'perMinute',
    ];
    return keys.every((k) => {
        const x = a[k];
        const y = b[k];
        if (x === null || y === null)
            return x === y;
        return Math.abs(x - y) < 1e-6;
    });
}
//# sourceMappingURL=usage.util.js.map