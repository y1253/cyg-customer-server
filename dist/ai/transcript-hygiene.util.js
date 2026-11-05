"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHallucinatedTranscript = isHallucinatedTranscript;
const HALLUCINATIONS = new Set([
    'thank you',
    'thanks',
    'thank you very much',
    'thank you for watching',
    'thanks for watching',
    'thank you for watching this video',
    'thank you for listening',
    'please subscribe',
    'like and subscribe',
    'subtitles by the amara org community',
    'subtitles by',
    'transcription by castingwords',
    'merci',
    'merci beaucoup',
    "merci d'avoir regarde",
    "merci d'avoir regarde cette video",
    "sous titres realises par la communaute d'amara org",
    'sous titres realises par',
    'abonnez vous',
    'you',
    'bye',
    'bye bye',
    'music',
    'musique',
    'applause',
    'silence',
    'blank audio',
    'inaudible',
    'www mooji org',
    'mooji org',
]);
function normalise(text) {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[[\](){}<>*_~#]/g, ' ')
        .replace(/[^\p{Letter}\p{Number}']+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
function isHallucinatedTranscript(text) {
    const normalised = normalise(text);
    return normalised === '' || HALLUCINATIONS.has(normalised);
}
//# sourceMappingURL=transcript-hygiene.util.js.map