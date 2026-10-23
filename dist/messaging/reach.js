"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firmReach = firmReach;
exports.reachWords = reachWords;
async function firmReach(prisma, config) {
    const env = (k) => !!config.get(k)?.trim();
    const [numbers, inbox, voice] = await Promise.all([
        prisma.intakeNumber.findMany({
            where: { releasedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { phoneNumber: true, whatsappStatus: true },
        }),
        prisma.customerInboxAccount.findFirst({
            orderBy: { id: 'desc' },
            select: { emailAddress: true },
        }),
        prisma.customerVoiceSettings
            .findUnique({ where: { singleton: 'GLOBAL' }, select: { enabled: true } })
            .catch(() => null),
    ]);
    return {
        numbers: numbers.map((n) => n.phoneNumber),
        whatsapp: numbers
            .filter((n) => n.whatsappStatus === 'CONNECTED')
            .map((n) => n.phoneNumber),
        voice: !!voice?.enabled &&
            numbers.length > 0 &&
            env('SIGNALWIRE_PROJECT_ID') &&
            env('SIGNALWIRE_API_TOKEN') &&
            env('SIGNALWIRE_SPACE_URL') &&
            env('OPENAI_API_KEY'),
        email: inbox?.emailAddress ?? null,
    };
}
function reachWords(r) {
    if (!r.numbers.length && !r.email)
        return null;
    const parts = [];
    if (r.numbers.length) {
        const how = [
            'text',
            ...(r.whatsapp.length ? ['WhatsApp'] : []),
            ...(r.voice ? ['call'] : []),
        ];
        const verbs = how.length > 1
            ? `${how.slice(0, -1).join(', ')} or ${how[how.length - 1]}`
            : how[0];
        parts.push(`${verbs} ${r.numbers[0]}`);
    }
    if (r.email)
        parts.push(`email ${r.email}`);
    return parts.join(', or ');
}
//# sourceMappingURL=reach.js.map