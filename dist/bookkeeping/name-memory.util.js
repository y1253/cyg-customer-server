"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameKey = exports.RULE_MATCH_TYPES = void 0;
exports.descriptionKey = descriptionKey;
exports.cleanName = cleanName;
exports.resolveRow = resolveRow;
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
function resolveRow(row, ctx) {
    let name = cleanName(row.name);
    let category = (0, chart_of_accounts_1.normalizeAccount)(row.offsetAccount);
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
    const apply = (rule) => {
        if (!rule)
            return;
        const ruleName = cleanName(rule.name);
        if (ruleName)
            name = ruleName;
        if (rule.category)
            category = (0, chart_of_accounts_1.normalizeAccount)(rule.category);
        source = 'customer';
    };
    if (key)
        apply(ctx.descRules.get(key));
    if (name)
        apply(ctx.nameRules.get((0, exports.nameKey)(name)));
    return { name, category, source };
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
    for (const r of rules) {
        if (r.matchType === 'DESCRIPTION')
            descRules.set(r.matchKey, r);
        else
            nameRules.set(r.matchKey, r);
    }
    return { descRules, nameRules };
}
//# sourceMappingURL=name-memory.util.js.map