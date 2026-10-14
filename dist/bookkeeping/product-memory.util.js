"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveItem = resolveItem;
exports.itemsToAsk = itemsToAsk;
exports.productMemoryWrites = productMemoryWrites;
exports.groupProducts = groupProducts;
const chart_of_accounts_1 = require("./chart-of-accounts");
const receipt_items_util_1 = require("./receipt-items.util");
function resolveItem(key, rules, memory, parentCategory) {
    const rule = key ? rules.get(key) : undefined;
    if (rule)
        return { category: rule, source: 'rule' };
    const remembered = key ? memory.get(key) : undefined;
    if (remembered && (0, chart_of_accounts_1.normalizeAccount)(remembered) !== chart_of_accounts_1.UNCATEGORIZED) {
        return { category: (0, chart_of_accounts_1.normalizeAccount)(remembered), source: 'memory' };
    }
    return { category: parentCategory, source: 'parent' };
}
function itemsToAsk(names, rules, memory) {
    const out = new Map();
    for (const name of names) {
        const key = (0, receipt_items_util_1.itemKey)(name);
        if (!key || out.has(key) || rules.has(key))
            continue;
        const known = memory.get(key);
        if (known && (0, chart_of_accounts_1.normalizeAccount)(known) !== chart_of_accounts_1.UNCATEGORIZED)
            continue;
        out.set(key, name.trim());
    }
    return [...out].map(([key, name]) => ({ key, name }));
}
function productMemoryWrites(answers, memory) {
    const creates = new Map();
    const fills = new Map();
    for (const a of answers) {
        const category = (0, chart_of_accounts_1.normalizeAccount)(a.category);
        if (!a.key || category === chart_of_accounts_1.UNCATEGORIZED)
            continue;
        const write = {
            itemKey: a.key,
            sampleName: a.name.trim().slice(0, 512),
            category,
        };
        const known = memory.get(a.key);
        if (known === undefined) {
            if (!creates.has(a.key))
                creates.set(a.key, write);
        }
        else if ((0, chart_of_accounts_1.normalizeAccount)(known) === chart_of_accounts_1.UNCATEGORIZED && !fills.has(a.key)) {
            fills.set(a.key, write);
        }
    }
    return { creates: [...creates.values()], fills: [...fills.values()] };
}
function groupProducts(rows, rules, memory) {
    const groups = new Map();
    for (const r of rows) {
        const key = (0, receipt_items_util_1.itemKey)(r.itemName);
        if (!key)
            continue;
        const g = groups.get(key) ?? {
            name: r.itemName,
            lastId: r.id,
            rows: 0,
            cents: 0,
            cats: new Map(),
        };
        if (r.id >= g.lastId) {
            g.lastId = r.id;
            g.name = r.itemName;
        }
        g.rows += 1;
        g.cents += Math.abs(Math.round(r.amount * 100));
        g.cats.set(r.offsetAccount, (g.cats.get(r.offsetAccount) ?? 0) + 1);
        groups.set(key, g);
    }
    return [...groups]
        .map(([key, g]) => {
        const usual = [...g.cats].sort((a, b) => b[1] - a[1])[0][0];
        const remembered = memory.get(key);
        const suggested = remembered && (0, chart_of_accounts_1.normalizeAccount)(remembered) !== chart_of_accounts_1.UNCATEGORIZED
            ? (0, chart_of_accounts_1.normalizeAccount)(remembered)
            : null;
        const rule = rules.get(key);
        return {
            itemKey: key,
            name: g.name,
            category: rule ?? usual,
            source: (rule
                ? 'rule'
                : suggested
                    ? 'memory'
                    : 'parent'),
            suggested,
            rows: g.rows,
            total: g.cents / 100,
        };
    })
        .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}
//# sourceMappingURL=product-memory.util.js.map