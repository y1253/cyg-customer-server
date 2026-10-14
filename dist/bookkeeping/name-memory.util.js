"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBankCharge = exports.nameKey = exports.RULE_MATCH_TYPES = void 0;
exports.descriptionKey = descriptionKey;
exports.cleanName = cleanName;
exports.bankPayeeName = bankPayeeName;
exports.isOwnersLoanMove = isOwnersLoanMove;
exports.resolveRow = resolveRow;
exports.resolveRows = resolveRows;
exports.nameMemoryWrites = nameMemoryWrites;
exports.memoryWrites = memoryWrites;
exports.indexRules = indexRules;
const chart_of_accounts_1 = require("./chart-of-accounts");
exports.RULE_MATCH_TYPES = [
    'NAME',
    'DESCRIPTION',
];
const KEY_MAX = 191;
const NAME_MAX = 191;
function descriptionKey(description) {
    return (description ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .split(' ')
        .filter((t) => t.length > 1)
        .join(' ')
        .slice(0, KEY_MAX)
        .trim();
}
function cleanName(name) {
    return (name ?? '').trim().slice(0, NAME_MAX) || null;
}
const nameKey = (name) => name.trim().toLowerCase();
exports.nameKey = nameKey;
const BANK_NAMES = [
    [/^td\b|toronto[- ]dominion/i, 'TD Bank'],
    [/^bmo\b|bank of montreal|banque de montr[ée]al/i, 'BMO'],
    [/^rbc\b|royal bank/i, 'RBC'],
    [/^cibc\b|canadian imperial/i, 'CIBC'],
    [/scotia/i, 'Scotiabank'],
    [/national bank|banque nationale/i, 'National Bank'],
    [/desjardins/i, 'Desjardins'],
];
function bankPayeeName(bankName) {
    const raw = cleanName(bankName);
    if (!raw)
        return null;
    return BANK_NAMES.find(([re]) => re.test(raw))?.[1] ?? raw;
}
const isBankCharge = (category) => /interest|bank fee|bank charge|service charge/i.test(category);
exports.isBankCharge = isBankCharge;
const OWN_MOVE_CATEGORIES = new Set([
    'Transfer Between Accounts',
    'Credit Card Payment',
]);
const NOT_OWN_MOVE = /\binterac\b|\be[- ]?(?:transfer|tfr)\b|\bemail money\b|\bwire\b/i;
const CARD = '(?:visa|master ?card|amex|american express|credit card|cc)';
const PAID = '(?:payment|pymt|pmt|paiement)';
const CARD_PAYMENT = new RegExp([
    `\\b${CARD}\\b.*\\b${PAID}\\b`,
    `\\b${PAID}\\b.*\\b${CARD}\\b`,
    `\\b${PAID}\\b.*\\b(?:thank you|merci)\\b`,
    '\\bpayment received\\b',
].join('|'), 'i');
const OWN_TRANSFER = /\b(?:transfer|xfer|tfr|virement)\b/i;
function isOwnersLoanMove(description, category) {
    if (OWN_MOVE_CATEGORIES.has(category))
        return true;
    if (NOT_OWN_MOVE.test(description))
        return false;
    return CARD_PAYMENT.test(description) || OWN_TRANSFER.test(description);
}
function resolveRow(row, ctx) {
    let name = cleanName(row.name);
    let category = (0, chart_of_accounts_1.normalizeAccount)(row.offsetAccount, ctx.customAccounts);
    let source = 'ai';
    const key = descriptionKey(row.description);
    const remembered = key ? ctx.memory.get(key) : undefined;
    if (remembered) {
        const memName = cleanName(remembered.name);
        const memCategory = (0, chart_of_accounts_1.normalizeAccount)(remembered.category);
        if (memName)
            name = memName;
        if (memCategory !== chart_of_accounts_1.UNCATEGORIZED)
            category = memCategory;
        if (memName || memCategory !== chart_of_accounts_1.UNCATEGORIZED)
            source = 'memory';
    }
    if (!name && (0, exports.isBankCharge)(category))
        name = bankPayeeName(ctx.bankName);
    const ownMove = isOwnersLoanMove(row.description, category);
    if (ownMove)
        category = chart_of_accounts_1.OWNERS_LOAN;
    const forced = ownMove || (0, exports.isBankCharge)(category);
    let customerName = false;
    let customerCategory = false;
    const apply = (rule) => {
        if (!rule)
            return;
        const ruleName = cleanName(rule.name);
        if (ruleName) {
            name = ruleName;
            customerName = true;
        }
        if (rule.category) {
            category = (0, chart_of_accounts_1.normalizeAccount)(rule.category, ctx.customAccounts);
            customerCategory = true;
        }
        source = 'customer';
    };
    if (key)
        apply(ctx.descRules.get(key));
    if (name)
        apply(ctx.nameRules.get((0, exports.nameKey)(name)));
    const own = name ? ctx.nameCategories?.get((0, exports.nameKey)(name)) : undefined;
    if (own) {
        category = (0, chart_of_accounts_1.normalizeAccount)(own, ctx.customAccounts);
        customerCategory = true;
        source = 'customer';
    }
    const followsName = !!name && !forced && !customerCategory;
    if (followsName) {
        const known = ctx.nameMemory?.get((0, exports.nameKey)(name));
        if (known && (0, chart_of_accounts_1.normalizeAccount)(known) !== chart_of_accounts_1.UNCATEGORIZED) {
            category = (0, chart_of_accounts_1.normalizeAccount)(known);
            if (source === 'ai')
                source = 'memory';
        }
    }
    return {
        name,
        category,
        source,
        followsName,
        learnable: followsName && !customerName,
    };
}
function resolveRows(rows, ctx) {
    const nameMemory = new Map(ctx.nameMemory ?? []);
    const first = rows.map((r) => resolveRow(r, ctx));
    let added = false;
    for (const out of first) {
        if (!out.followsName || !out.name || out.category === chart_of_accounts_1.UNCATEGORIZED) {
            continue;
        }
        const k = (0, exports.nameKey)(out.name);
        const known = nameMemory.get(k);
        if (known && (0, chart_of_accounts_1.normalizeAccount)(known) !== chart_of_accounts_1.UNCATEGORIZED)
            continue;
        nameMemory.set(k, out.category);
        added = true;
    }
    if (!added)
        return { resolved: first, nameMemory };
    const next = { ...ctx, nameMemory };
    return { resolved: rows.map((r) => resolveRow(r, next)), nameMemory };
}
function nameMemoryWrites(resolved, known) {
    const creates = new Map();
    const fills = new Map();
    for (const r of resolved) {
        if (!r.learnable || !r.name || r.category === chart_of_accounts_1.UNCATEGORIZED)
            continue;
        if (!chart_of_accounts_1.ACCOUNT_NAMES.includes(r.category))
            continue;
        const k = (0, exports.nameKey)(r.name).slice(0, KEY_MAX);
        if (!k)
            continue;
        const write = { nameKey: k, sampleName: r.name, category: r.category };
        const had = known.get(k);
        if (had === undefined) {
            if (!creates.has(k))
                creates.set(k, write);
        }
        else if ((0, chart_of_accounts_1.normalizeAccount)(had) === chart_of_accounts_1.UNCATEGORIZED && !fills.has(k)) {
            fills.set(k, write);
        }
    }
    return { creates: [...creates.values()], fills: [...fills.values()] };
}
function memoryWrites(rows, memory) {
    const creates = new Map();
    const fills = new Map();
    for (const row of rows) {
        const key = descriptionKey(row.description);
        if (!key)
            continue;
        const name = cleanName(row.name);
        const category = (0, chart_of_accounts_1.normalizeAccount)(row.offsetAccount);
        if (!name && category === chart_of_accounts_1.UNCATEGORIZED)
            continue;
        const write = {
            descriptionKey: key,
            sampleDescription: row.description.trim().slice(0, 512),
            name,
            category,
        };
        const known = memory.get(key);
        if (!known) {
            if (!creates.has(key))
                creates.set(key, write);
            continue;
        }
        const fillName = !cleanName(known.name) && name;
        const fillCategory = (0, chart_of_accounts_1.normalizeAccount)(known.category) === chart_of_accounts_1.UNCATEGORIZED &&
            category !== chart_of_accounts_1.UNCATEGORIZED;
        if ((fillName || fillCategory) && !fills.has(key)) {
            fills.set(key, {
                ...write,
                name: fillName ? name : cleanName(known.name),
                category: fillCategory ? category : (0, chart_of_accounts_1.normalizeAccount)(known.category),
            });
        }
    }
    return { creates: [...creates.values()], fills: [...fills.values()] };
}
function indexRules(rules) {
    const descRules = new Map();
    const nameRules = new Map();
    const nameCategories = new Map();
    for (const r of rules) {
        if (r.matchType === 'DESCRIPTION')
            descRules.set(r.matchKey, r);
        else
            nameRules.set(r.matchKey, r);
    }
    for (const r of nameRules.values()) {
        if (!r.category || !cleanName(r.name))
            continue;
        const k = (0, exports.nameKey)(r.name);
        if (!nameCategories.has(k))
            nameCategories.set(k, r.category);
    }
    for (const r of nameRules.values()) {
        if (r.category && !cleanName(r.name))
            nameCategories.set(r.matchKey, r.category);
    }
    return { descRules, nameRules, nameCategories };
}
//# sourceMappingURL=name-memory.util.js.map