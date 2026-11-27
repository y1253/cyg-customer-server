"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastDigits = lastDigits;
exports.sameKind = sameKind;
exports.nameScore = nameScore;
exports.verifyMatch = verifyMatch;
exports.acceptMatch = acceptMatch;
exports.candidatesFor = candidatesFor;
const GENERIC = new Set([
    'bank',
    'the',
    'of',
    'and',
    'canada',
    'trust',
    'financial',
    'credit',
    'union',
    'card',
    'account',
    'chequing',
    'checking',
    'savings',
    'visa',
    'mastercard',
    'business',
]);
const norm = (v) => v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const words = (v) => norm(v ?? '')
    .split(' ')
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !GENERIC.has(w));
function lastDigits(ours) {
    const mask = (ours.mask ?? '').replace(/\D/g, '');
    if (mask.length >= 4)
        return mask.slice(-4);
    const m = /(\d{4})\D*$/.exec(ours.accountName);
    return m ? m[1] : null;
}
function sameKind(ours, theirs) {
    return ours.kind === 'CREDIT_CARD'
        ? theirs.type === 'Credit Card'
        : theirs.type === 'Bank';
}
function nameScore(ours, theirs) {
    if (!sameKind(ours, theirs))
        return -1;
    let score = 0;
    if (norm(ours.accountName) === norm(theirs.name))
        score += 10;
    const last4 = lastDigits(ours);
    if (last4) {
        const digits = theirs.name.replace(/\D/g, '');
        const num = (theirs.acctNum ?? '').replace(/\D/g, '');
        if (digits.endsWith(last4) || digits.includes(last4) || num.endsWith(last4))
            score += 5;
    }
    const theirWords = new Set(words(theirs.name));
    const bankWords = [...words(ours.institution), ...words(ours.accountName)];
    if (bankWords.some((w) => theirWords.has(w)))
        score += 2;
    return score;
}
const dayOf = (iso) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);
function verifyMatch(ours, theirs) {
    const pool = new Map();
    for (const t of theirs) {
        const list = pool.get(t.cents);
        if (list)
            list.push(dayOf(t.date));
        else
            pool.set(t.cents, [dayOf(t.date)]);
    }
    let matched = 0;
    for (const o of ours) {
        const list = pool.get(o.cents);
        if (!list?.length)
            continue;
        const d = dayOf(o.date);
        let best = -1;
        for (let i = 0; i < list.length; i++) {
            const gap = Math.abs(list[i] - d);
            if (gap <= 3 && (best < 0 || gap < Math.abs(list[best] - d)))
                best = i;
        }
        if (best >= 0) {
            list.splice(best, 1);
            matched++;
        }
    }
    return { matched, compared: ours.length };
}
function acceptMatch(score, v, theirCount) {
    if (score < 0)
        return false;
    if (!v.compared || !theirCount)
        return score >= 10;
    const ratio = v.matched / v.compared;
    if (score > 0)
        return v.matched >= 3 && ratio >= 0.5;
    return v.matched >= 5 && ratio >= 0.7;
}
function candidatesFor(ours, theirs, max = 3) {
    return theirs
        .map((account) => ({ account, score: nameScore(ours, account) }))
        .filter((c) => c.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);
}
//# sourceMappingURL=qbo-bank-match.util.js.map