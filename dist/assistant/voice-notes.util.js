"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVoiceMessage = isVoiceMessage;
exports.spokenMessage = spokenMessage;
const client_1 = require("@prisma/client");
function isVoiceMessage(a) {
    return (a.kind === client_1.AttachmentKind.AUDIO && a.status === client_1.AttachmentStatus.DOCUMENT);
}
function spokenMessage(text, files) {
    const parts = [];
    const typed = text?.trim();
    if (typed)
        parts.push(typed);
    const kept = [];
    const voiceOnly = [];
    const heard = [
        ...new Set(files
            .filter((f) => f.kind === client_1.AttachmentKind.AUDIO)
            .map((f) => f.reading?.transcript?.trim() ?? '')
            .filter(Boolean)),
    ];
    const label = heard.length > 1 || !!typed;
    for (const said of heard)
        parts.push(label ? `(voice note) ${said}` : said);
    for (const f of files) {
        const said = f.kind === client_1.AttachmentKind.AUDIO ? f.reading?.transcript?.trim() : '';
        if (said && isVoiceMessage(f))
            voiceOnly.push(f.id);
        else
            kept.push(f);
    }
    return { words: parts.join('\n\n'), files: kept, voiceOnly };
}
//# sourceMappingURL=voice-notes.util.js.map