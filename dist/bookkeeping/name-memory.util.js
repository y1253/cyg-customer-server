"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RULE_CONFLICT = exports.byContainsPriority = exports.isBankCharge = exports.nameKey = exports.descriptionContains = exports.containsKey = exports.CONTAINS_MIN = exports.RULE_MATCH_TYPES = exports.EXCEPTION = void 0;
exports.descriptionKey = descriptionKey;
exports.cleanName = cleanName;
exports.descriptionName = descriptionName;
exports.fallbackName = fallbackName;
exports.exceptionKey = exceptionKey;
exports.bankPayeeName = bankPayeeName;
exports.isOwnersLoanMove = isOwnersLoanMove;
exports.resolveRow = resolveRow;
exports.resolveRows = resolveRows;
exports.nameMemoryWrites = nameMemoryWrites;
exports.memoryWrites = memoryWrites;
exports.containsRuleFor = containsRuleFor;
exports.indexRules = indexRules;
exports.findLinkConflicts = findLinkConflicts;
exports.rowNameConflicts = rowNameConflicts;
exports.linkConflictMessage = linkConflictMessage;
const chart_of_accounts_1 = require("./chart-of-accounts");
exports.EXCEPTION = 'EXCEPTION';
exports.RULE_MATCH_TYPES = [
    'NAME',
    'DESCRIPTION',
    'CONTAINS',
];
exports.CONTAINS_MIN = 3;
const containsKey = (text) => text.trim().toLowerCase().slice(0, KEY_MAX);
exports.containsKey = containsKey;
const descriptionContains = (description, key) => !!key && description.toLowerCase().includes(key);
exports.descriptionContains = descriptionContains;
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
function descriptionName(description) {
    return cleanName(description.replace(/\s+/g, ' '));
}
function fallbackName(name, category, description) {
    const clean = cleanName(name);
    const fromDescription = descriptionName(description);
    if (category === chart_of_accounts_1.UNCATEGORIZED)
        return clean && clean === fromDescription ? null : clean;
    return clean ?? fromDescription;
}
const nameKey = (name) => name.trim().toLowerCase();
exports.nameKey = nameKey;
function exceptionKey(row) {
    if (row.externalId)
        return `p:${row.externalId}`.slice(0, 191);
    const date = row.postingDate ?? row.pendingDate ?? null;
    const day = date === null
        ? '-'
        : typeof date === 'string'
            ? date.slice(0, 10)
            : date.toISOString().slice(0, 10);
    const cents = Math.round(Number(row.amount.toString()) * 100);
    const desc = row.description.trim().toLowerCase();
    let h = 0;
    for (let i = 0; i < desc.length; i++)
        h = (h * 31 + desc.charCodeAt(i)) | 0;
    return `x:${row.statementId}:${day}:${cents}:${(h >>> 0).toString(36)}:${desc.length}`;
}
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
    let generalRuleId = null;
    let personalRuleId = null;
    const remembered = key ? ctx.memory.get(key) : undefined;
    if (remembered) {
        const memName = cleanName(remembered.name);
        const memCategory = (0, chart_of_accounts_1.normalizeAccount)(remembered.category);
        if (memName)
            name = memName;
        if (memCategory !== chart_of_accounts_1.UNCATEGORIZED)
            category = memCategory;
        if (memName || memCategory !== chart_of_accounts_1.UNCATEGORIZED) {
            source = 'memory';
            generalRuleId = remembered.id ?? null;
        }
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
        if (rule.id !== undefined && (ruleName || personalRuleId === null))
            personalRuleId = rule.id;
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
    const exact = key ? ctx.descRules.get(key) : undefined;
    if (exact)
        apply(exact);
    else
        apply(containsRuleFor(row.description, ctx.containsRules));
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
    const ruleName = name;
    const exception = row.exceptionKey
        ? ctx.exceptions?.get(row.exceptionKey)
        : undefined;
    if (exception) {
        const exName = cleanName(exception.name);
        if (exName)
            name = exName;
        if (exception.category)
            category = (0, chart_of_accounts_1.normalizeAccount)(exception.category, ctx.customAccounts);
        source = 'customer';
    }
    category = ctx.renamed?.get(category.toLowerCase()) ?? category;
    const finalName = fallbackName(name, category, row.description);
    const fromDescription = !!finalName && finalName === descriptionName(row.description);
    return {
        name: finalName,
        category,
        source,
        followsName: followsName && !exception,
        learnable: followsName && !customerName && !exception && !fromDescription,
        generalRuleId,
        personalRuleId,
        exceptionRuleId: exception?.id ?? null,
        ruleName: fallbackName(ruleName, category, row.description),
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
const byContainsPriority = (a, b) => b.matchKey.length - a.matchKey.length || a.matchKey.localeCompare(b.matchKey);
exports.byContainsPriority = byContainsPriority;
function containsRuleFor(description, rules) {
    return rules?.find((r) => (0, exports.descriptionContains)(description, r.matchKey));
}
function indexRules(rules) {
    const descRules = new Map();
    const nameRules = new Map();
    const containsRules = [];
    const nameCategories = new Map();
    const exceptions = new Map();
    for (const r of rules) {
        if (r.matchType === 'DESCRIPTION')
            descRules.set(r.matchKey, r);
        else if (r.matchType === 'CONTAINS') {
            if (r.matchKey)
                containsRules.push(r);
        }
        else if (r.matchType === exports.EXCEPTION)
            exceptions.set(r.matchKey, r);
        else
            nameRules.set(r.matchKey, r);
    }
    containsRules.sort(exports.byContainsPriority);
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
    return { descRules, nameRules, containsRules, nameCategories, exceptions };
}
exports.RULE_CONFLICT = 'RULE_CONFLICT';
function findLinkConflicts(input) {
    const { key, rules } = input;
    const target = (0, exports.nameKey)(input.name);
    const other = (r) => !!cleanName(r.name) && (0, exports.nameKey)(r.name) !== target;
    const textOf = (r) => r.includeChars?.trim() || r.matchKey;
    const contains = rules
        .filter((r) => r.matchType === 'CONTAINS' && r.matchKey)
        .sort(exports.byContainsPriority);
    const out = [];
    const seen = new Set();
    const push = (c) => {
        const k = `${c.matchType}:${c.ruleId ?? c.text}`;
        if (seen.has(k))
            return;
        seen.add(k);
        out.push(c);
    };
    if (input.matchType === 'DESCRIPTION') {
        const printed = input.descriptions.filter((d) => descriptionKey(d) === key);
        const exact = rules.find((r) => r.matchType === 'DESCRIPTION' && r.matchKey === key);
        if (exact && cleanName(exact.name)) {
            if (other(exact)) {
                push({
                    matchType: 'DESCRIPTION',
                    text: printed[0] ?? key,
                    name: cleanName(exact.name),
                    ruleId: exact.id,
                    remove: false,
                });
            }
            return out;
        }
        for (const d of printed) {
            const r = containsRuleFor(d, contains);
            if (r && other(r)) {
                push({
                    matchType: 'CONTAINS',
                    text: textOf(r),
                    name: cleanName(r.name),
                    ruleId: r.id,
                    remove: false,
                });
            }
        }
        return out;
    }
    for (const r of contains) {
        if (!other(r))
            continue;
        const longer = r.matchKey !== key && r.matchKey.includes(key);
        if (longer || key.includes(r.matchKey)) {
            push({
                matchType: 'CONTAINS',
                text: textOf(r),
                name: cleanName(r.name),
                ruleId: r.id,
                remove: longer,
            });
        }
    }
    const exact = new Map(rules
        .filter((r) => r.matchType === 'DESCRIPTION' && other(r))
        .map((r) => [r.matchKey, r]));
    if (!exact.size)
        return out;
    for (const d of input.descriptions) {
        if (!(0, exports.descriptionContains)(d, key))
            continue;
        const r = exact.get(descriptionKey(d));
        if (r) {
            push({
                matchType: 'DESCRIPTION',
                text: d,
                name: cleanName(r.name),
                ruleId: r.id,
                remove: true,
            });
        }
    }
    return out;
}
function rowNameConflicts(input) {
    const target = (0, exports.nameKey)(input.name);
    const skip = new Set((input.ignore ?? []).map(exports.nameKey));
    const exact = new Set((input.rules ?? [])
        .filter((r) => r.matchType === 'DESCRIPTION')
        .map((r) => r.matchKey));
    const longer = (input.rules ?? []).filter((r) => r.matchType === 'CONTAINS' &&
        r.matchKey.length > input.key.length &&
        r.matchKey.includes(input.key));
    const reaches = (d) => input.matchType === 'DESCRIPTION'
        ? descriptionKey(d) === input.key
        : (0, exports.descriptionContains)(d, input.key) &&
            !exact.has(descriptionKey(d)) &&
            !longer.some((r) => (0, exports.descriptionContains)(d, r.matchKey));
    const byName = new Map();
    for (const r of input.rows) {
        const name = cleanName(r.name);
        if (!name || r.manualEdit || !reaches(r.description))
            continue;
        const k = (0, exports.nameKey)(name);
        if (k === target || skip.has(k) || byName.has(k))
            continue;
        byName.set(k, {
            matchType: 'DESCRIPTION',
            text: r.description,
            name,
            remove: false,
        });
    }
    return [...byName.values()];
}
function linkConflictMessage(conflicts, name) {
    const names = [...new Set(conflicts.map((c) => c.name))];
    const shown = conflicts
        .slice(0, 5)
        .map((c) => `"${c.text}" → ${c.name}`)
        .join('; ');
    const more = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : '';
    return (`Already linked to ${names.length > 1 ? 'other names' : names[0]}: ${shown}${more}. ` +
        `Confirm to take it away from ${names.join(', ')} and link it to ${name}, ` +
        `or change only this transaction instead.`);
}
//# sourceMappingURL=name-memory.util.js.map