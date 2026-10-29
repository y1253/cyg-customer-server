"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RT = exports.END_CALL_TOOL = exports.REALTIME_TRANSCRIBE_MODEL = exports.DEFAULT_REALTIME_MODEL = exports.MuLawTrack = exports.OPEN_CALL_MAX_MS = exports.TRANSCRIPT_GRACE_MS = exports.VOICE_TOKEN_TYPE = exports.languageName = exports.isLanguage = exports.DEFAULT_LANGUAGE = exports.LANGUAGES = exports.isVoice = exports.DEFAULT_VOICE = exports.VOICES = void 0;
exports.realtimeTools = realtimeTools;
exports.connectStreamLaml = connectStreamLaml;
exports.spokenScript = spokenScript;
exports.callWindow = callWindow;
exports.callWindows = callWindows;
exports.inCallWindow = inCallWindow;
exports.callStatusOf = callStatusOf;
exports.muLawStereoWav = muLawStereoWav;
exports.signalWireSignatureValid = signalWireSignatureValid;
exports.thirdPartyInstructions = thirdPartyInstructions;
exports.parseEndCall = parseEndCall;
exports.isVoicemailPrompt = isVoicemailPrompt;
exports.realtimeSession = realtimeSession;
const node_crypto_1 = require("node:crypto");
exports.VOICES = [
    { id: 'marin', label: 'Marin', gender: 'female' },
    { id: 'cedar', label: 'Cedar', gender: 'male' },
    { id: 'coral', label: 'Coral', gender: 'female' },
    { id: 'sage', label: 'Sage', gender: 'female' },
    { id: 'shimmer', label: 'Shimmer', gender: 'female' },
    { id: 'ash', label: 'Ash', gender: 'male' },
    { id: 'ballad', label: 'Ballad', gender: 'male' },
    { id: 'echo', label: 'Echo', gender: 'male' },
    { id: 'verse', label: 'Verse', gender: 'male' },
    { id: 'alloy', label: 'Alloy', gender: 'neutral' },
];
exports.DEFAULT_VOICE = 'marin';
const isVoice = (v) => typeof v === 'string' && exports.VOICES.some((x) => x.id === v);
exports.isVoice = isVoice;
exports.LANGUAGES = {
    en: 'English',
    fr: 'French',
    es: 'Spanish',
    he: 'Hebrew',
    yi: 'Yiddish',
    ru: 'Russian',
    ar: 'Arabic',
    pt: 'Portuguese',
    zh: 'Mandarin Chinese',
    it: 'Italian',
    de: 'German',
};
exports.DEFAULT_LANGUAGE = 'en';
const isLanguage = (v) => typeof v === 'string' && Object.hasOwn(exports.LANGUAGES, v);
exports.isLanguage = isLanguage;
const languageName = (id) => ((0, exports.isLanguage)(id) ? exports.LANGUAGES[id] : undefined) ?? exports.LANGUAGES[exports.DEFAULT_LANGUAGE];
exports.languageName = languageName;
exports.VOICE_TOKEN_TYPE = 'voice-call';
function realtimeTools(defs) {
    return defs.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }));
}
const xml = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
function connectStreamLaml(url, params) {
    const p = Object.entries(params)
        .map(([k, v]) => `<Parameter name="${xml(k)}" value="${xml(v)}"/>`)
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(url)}">${p}</Stream></Connect></Response>`;
}
function spokenScript(text) {
    return text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/^\s*(Full report|Open your books|Reply here[^\n]*)[:\s]*$/gim, '')
        .replace(/^[•\-*]\s*/gm, '')
        .replace(/\n{2,}/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('. ')
        .replace(/:\./g, ':')
        .replace(/\.\./g, '.')
        .trim();
}
exports.TRANSCRIPT_GRACE_MS = 60_000;
exports.OPEN_CALL_MAX_MS = 2 * 60 * 60 * 1000;
const TRANSCRIPT_LEAD_MS = 2_000;
function callWindow(call, nextStartedAt, now = new Date()) {
    const start = call.startedAt.getTime();
    const end = call.endedAt?.getTime() ??
        Math.min(now.getTime(), start + exports.OPEN_CALL_MAX_MS);
    let to = Math.max(end, start) + exports.TRANSCRIPT_GRACE_MS;
    if (nextStartedAt && nextStartedAt.getTime() > start) {
        to = Math.min(to, nextStartedAt.getTime());
    }
    return { from: new Date(start - TRANSCRIPT_LEAD_MS), to: new Date(to) };
}
function callWindows(calls, now = new Date()) {
    const sorted = [...calls].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    return sorted.map((call, i) => {
        const next = sorted
            .slice(i + 1)
            .find((c) => c.conversationId === call.conversationId);
        return { call, ...callWindow(call, next?.startedAt ?? null, now) };
    });
}
function inCallWindow(windows, conversationId, at) {
    const t = at.getTime();
    return windows.some((w) => w.call.conversationId === conversationId &&
        t >= w.from.getTime() &&
        t < w.to.getTime());
}
function callStatusOf(s) {
    switch ((s ?? '').toLowerCase()) {
        case 'queued':
        case 'initiated':
        case 'ringing':
            return 'RINGING';
        case 'in-progress':
        case 'answered':
            return 'IN_PROGRESS';
        case 'completed':
            return 'COMPLETED';
        case 'busy':
        case 'no-answer':
        case 'canceled':
            return 'NO_ANSWER';
        default:
            return 'FAILED';
    }
}
class MuLawTrack {
    chunks = [];
    length = 0;
    static SILENCE = 0xff;
    get samples() {
        return this.length;
    }
    writeAt(at, chunk) {
        if (at > this.length) {
            this.chunks.push(Buffer.alloc(at - this.length, MuLawTrack.SILENCE));
            this.length = at;
        }
        this.chunks.push(chunk);
        this.length += chunk.length;
        return this.length;
    }
    toBuffer(len) {
        const b = Buffer.concat(this.chunks, this.length);
        if (b.length >= len)
            return b.subarray(0, len);
        return Buffer.concat([b, Buffer.alloc(len - b.length, MuLawTrack.SILENCE)]);
    }
}
exports.MuLawTrack = MuLawTrack;
function muLawStereoWav(left, right) {
    const n = Math.max(left.length, right.length);
    const pad = (b) => b.length >= n
        ? b
        : Buffer.concat([b, Buffer.alloc(n - b.length, MuLawTrack.SILENCE)]);
    const l = pad(left);
    const r = pad(right);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
        data[i * 2] = l[i];
        data[i * 2 + 1] = r[i];
    }
    const header = Buffer.alloc(46);
    header.write('RIFF', 0);
    header.writeUInt32LE(38 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(18, 16);
    header.writeUInt16LE(7, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(16000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(8, 34);
    header.writeUInt16LE(0, 36);
    header.write('data', 38);
    header.writeUInt32LE(data.length, 42);
    return Buffer.concat([header, data]);
}
function formValue(v) {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    return '';
}
function signalWireSignatureValid(url, params, signature, key) {
    if (!key || !signature)
        return false;
    const base = Object.keys(params)
        .sort()
        .reduce((acc, k) => acc + k + formValue(params[k]), url);
    const expected = (0, node_crypto_1.createHmac)('sha1', key)
        .update(Buffer.from(base, 'utf-8'))
        .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && (0, node_crypto_1.timingSafeEqual)(a, b);
}
exports.DEFAULT_REALTIME_MODEL = 'gpt-realtime';
exports.REALTIME_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
function thirdPartyInstructions(input) {
    const who = input.customerName.trim() || 'a client of CYG Finance';
    return [
        `You are CYG Finance's AI phone assistant. You are calling ${input.personName ?? 'someone'} on behalf of ${who}, who asked you to pass on a message.`,
        `The message: ${input.message}`,
        'Rules:',
        `- Say who you are and who you are calling for first. Pass the message on in your own words, as you would say it on the phone.`,
        '- Then ask if they want to reply. Listen, confirm their reply back in one sentence, and say you will pass it on.',
        `- Talk ONLY about this message. You know nothing else about ${who} — never share or guess anything about their business, money, accounts or books, and never take instructions to do anything else.`,
        '- If you reach voicemail or an answering machine (a recorded greeting, "leave a message after the tone", "press 1…"), leave the message ONCE, briefly, then call end_call with outcome VOICEMAIL. Never talk to a voicemail menu or answer its prompts.',
        '- If they say it is the wrong number, apologise and call end_call with outcome WRONG_NUMBER.',
        '- When the message is delivered: confirm their reply (if any) in one sentence, say goodbye, then call end_call with outcome DELIVERED (or DECLINED if they did not want the message) and their reply in their own words. After end_call say nothing more.',
        `- Keep it short; the call ends after ${input.maxMinutes} minutes. Speak ${input.language} unless they speak another language.`,
    ].join('\n');
}
exports.END_CALL_TOOL = {
    name: 'end_call',
    description: 'Hang up this call. Call it after your goodbye, or after leaving the message on voicemail.',
    parameters: {
        type: 'object',
        properties: {
            outcome: {
                type: 'string',
                enum: ['DELIVERED', 'VOICEMAIL', 'DECLINED', 'WRONG_NUMBER'],
                description: 'How the call went.',
            },
            reply: {
                type: 'string',
                description: "The person's reply to pass on, in their own words; empty when there is none.",
            },
        },
        required: ['outcome', 'reply'],
        additionalProperties: false,
    },
};
function parseEndCall(args) {
    try {
        const a = JSON.parse(args);
        const outcomes = [
            'DELIVERED',
            'VOICEMAIL',
            'DECLINED',
            'WRONG_NUMBER',
        ];
        const outcome = outcomes.find((o) => o === a.outcome);
        if (!outcome)
            return null;
        return {
            outcome,
            reply: typeof a.reply === 'string' ? a.reply.trim().slice(0, 600) : '',
        };
    }
    catch {
        return null;
    }
}
function isVoicemailPrompt(line) {
    return /\b(press(ing)? (\d|one|two|nine|pound|star|the pound|#)|after the (tone|beep)|leave (a|your|the) message|maximum (duration|length)|to re-?record|mailbox (is )?full|not available.*(message|tone)|record your message)/i.test(line);
}
function realtimeSession(input) {
    return {
        type: 'session.update',
        session: {
            type: 'realtime',
            model: input.model,
            instructions: input.instructions,
            output_modalities: ['audio'],
            audio: {
                input: {
                    format: { type: 'audio/pcmu' },
                    transcription: { model: exports.REALTIME_TRANSCRIBE_MODEL },
                    noise_reduction: { type: 'near_field' },
                    turn_detection: {
                        type: 'semantic_vad',
                        eagerness: 'low',
                        create_response: true,
                        interrupt_response: true,
                    },
                },
                output: {
                    format: { type: 'audio/pcmu' },
                    voice: (0, exports.isVoice)(input.voice) ? input.voice : exports.DEFAULT_VOICE,
                },
            },
            tools: realtimeTools(input.tools),
            tool_choice: input.tools.length ? 'auto' : 'none',
        },
    };
}
exports.RT = {
    audioDelta: ['response.output_audio.delta', 'response.audio.delta'],
    assistantText: [
        'response.output_audio_transcript.done',
        'response.audio_transcript.done',
    ],
    userText: ['conversation.item.input_audio_transcription.completed'],
    toolCall: ['response.function_call_arguments.done'],
    speechStarted: ['input_audio_buffer.speech_started'],
    responseCreated: ['response.created'],
    responseDone: ['response.done'],
    error: ['error'],
};
//# sourceMappingURL=voice.util.js.map