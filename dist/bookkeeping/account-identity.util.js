"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bankTextOf = bankTextOf;
exports.digitsOf = digitsOf;
exports.sameAccountDigits = sameAccountDigits;
exports.isSameAccount = isSameAccount;
exports.canonicalAccountName = canonicalAccountName;
exports.mergeGroups = mergeGroups;
const MIN_DIGITS = 4;
function bankTextOf(name) {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function digitsOf(name) {
    return name.replace(/\D/g, '');
}
function sameAccountDigits(a, b) {
    if (a.length < MIN_DIGITS || b.length < MIN_DIGITS)
        return false;
    if (a === b)
        return true;
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return long.startsWith(short) || long.endsWith(short);
}
const kindOf = (k) => (k === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK');
function isSameAccount(a, b) {
    return (kindOf(a.kind) === kindOf(b.kind) &&
        bankTextOf(a.name) !== '' &&
        bankTextOf(a.name) === bankTextOf(b.name) &&
        sameAccountDigits(a.digits || digitsOf(a.name), b.digits || digitsOf(b.name)));
}
function canonicalAccountName(read, existing) {
    const name = read.accountName?.trim() || null;
    if (!name)
        return null;
    const number = read.accountNumber && read.accountNumber.length >= MIN_DIGITS ? read.accountNumber : null;
    const me = { name, kind: read.accountKind, digits: number ?? digitsOf(name) };
    if (existing.some((e) => e.name === name && kindOf(e.kind) === kindOf(me.kind)))
        return name;
    const matches = [...new Set(existing.filter((e) => isSameAccount(me, e)).map((e) => e.name))];
    if (matches.length === 1)
        return matches[0];
    if (matches.length > 1)
        return name;
    if (number) {
        const text = name.replace(/[\d\s-]+$/g, '').trim() || name;
        return `${text} ${number.slice(-MIN_DIGITS)}`;
    }
    return name;
}
function mergeGroups(accounts) {
    const n = accounts.length;
    const same = (i, j) => isSameAccount(accounts[i], accounts[j]);
    const parent = accounts.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++)
            if (same(i, j))
                parent[find(i)] = find(j);
    }
    const groups = new Map();
    for (let i = 0; i < n; i++)
        groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
    const out = [];
    for (const members of groups.values()) {
        if (members.length < 2)
            continue;
        const consistent = members.every((i) => members.every((j) => i === j || same(i, j)));
        if (!consistent)
            continue;
        const sorted = [...members].sort((a, b) => accounts[b].statements - accounts[a].statements ||
            accounts[a].name.length - accounts[b].name.length);
        out.push({
            keep: accounts[sorted[0]].name,
            merge: sorted.slice(1).map((i) => accounts[i].name),
        });
    }
    return out;
}
//# sourceMappingURL=account-identity.util.js.map