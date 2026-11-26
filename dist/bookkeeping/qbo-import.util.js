"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUncategorizedQbo = exports.nameKey = exports.MATCH_DAYS = exports.QBO = exports.OURS = exports.SKIP = exports.SPLIT = void 0;
exports.cleanTxns = cleanTxns;
exports.matchTxns = matchTxns;
exports.analyze = analyze;
exports.accountTypeOf = accountTypeOf;
const name_memory_util_1 = require("./name-memory.util");
exports.SPLIT = '__SPLIT__';
exports.SKIP = '__SKIP__';
exports.OURS = '__OURS__';
exports.QBO = '__QBO__';
const DAY_MS = 86_400_000;
exports.MATCH_DAYS = 3;
const UNCATEGORIZED_QBO = /^uncategori[sz]ed( (expense|income|asset))?$/i;
const nameKey = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();
exports.nameKey = nameKey;
const dayOf = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
function cleanTxns(input) {
    if (!Array.isArray(input))
        return [];
    const out = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object')
            continue;
        const date = typeof raw.date === 'string' ? raw.date.slice(0, 10) : '';
        const cents = Number(raw.cents);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(cents) || !cents)
            continue;
        const lines = Array.isArray(raw.lines)
            ? raw.lines.flatMap((l) => {
                const category = typeof l?.category === 'string' ? l.category.trim() : '';
                const c = Math.abs(Math.round(Number(l?.cents)));
                if (!category || !Number.isFinite(c))
                    return [];
                return [
                    {
                        category: category.slice(0, 120),
                        categoryType: typeof l.categoryType === 'string' ? l.categoryType : null,
                        cents: c,
                    },
                ];
            })
            : [];
        const str = (v, max = 191) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
        out.push({
            qboId: str(raw.qboId, 32) ?? '',
            type: raw.type === 'Deposit' ? 'Deposit' : 'Purchase',
            date,
            cents: Math.round(cents),
            bankAccountId: str(raw.bankAccountId, 32),
            bankAccountName: str(raw.bankAccountName),
            payee: str(raw.payee, 100),
            lines,
        });
    }
    return out;
}
function matchTxns(txns, rows) {
    const byCents = new Map();
    for (const r of rows) {
        if (!r.date)
            continue;
        const list = byCents.get(r.cents) ?? [];
        list.push(r);
        byCents.set(r.cents, list);
    }
    const used = new Set();
    const out = new Map();
    const ordered = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    for (const t of ordered) {
        const when = dayOf(t.date);
        const near = (byCents.get(t.cents) ?? []).filter((r) => !used.has(r.id) &&
            Math.abs(dayOf(r.date) - when) <= exports.MATCH_DAYS * DAY_MS);
        if (!near.length)
            continue;
        const sameAccount = near.filter((r) => (t.bankAccountId && r.qboAccountId === t.bankAccountId) ||
            (t.bankAccountName &&
                r.accountName &&
                (0, exports.nameKey)(r.accountName) === (0, exports.nameKey)(t.bankAccountName)));
        let pick;
        if (sameAccount.length) {
            pick = sameAccount.sort((a, b) => Math.abs(dayOf(a.date) - when) - Math.abs(dayOf(b.date) - when) ||
                a.id - b.id)[0];
        }
        else if (near.length === 1) {
            pick = near[0];
        }
        if (!pick)
            continue;
        used.add(pick.id);
        out.set(t.qboId, pick);
    }
    return out;
}
function realCategories(t) {
    return [
        ...new Set(t.lines.map((l) => l.category).filter((c) => !UNCATEGORIZED_QBO.test(c))),
    ];
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function analyze(input) {
    const { txns, rows, rules } = input;
    const matches = matchTxns(txns, rows);
    const payees = new Map();
    for (const t of txns) {
        if (!t.payee)
            continue;
        const key = (0, exports.nameKey)(t.payee);
        const acc = payees.get(key) ?? {
            spellings: new Map(),
            categories: new Map(),
            count: 0,
        };
        acc.count++;
        acc.spellings.set(t.payee, (acc.spellings.get(t.payee) ?? 0) + 1);
        for (const c of realCategories(t))
            acc.categories.set(c, (acc.categories.get(c) ?? 0) + 1);
        payees.set(key, acc);
    }
    const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0][0];
    const payeeName = (key) => top(payees.get(key).spellings);
    const aliasVotes = new Map();
    const descVotes = new Map();
    for (const t of txns) {
        const row = matches.get(t.qboId);
        if (!row || !t.payee)
            continue;
        const payeeKey = (0, exports.nameKey)(t.payee);
        if (row.name && (0, exports.nameKey)(row.name) !== payeeKey) {
            const k = (0, exports.nameKey)(row.name);
            const v = aliasVotes.get(k) ?? {
                spelling: row.name.trim(),
                to: new Map(),
            };
            v.to.set(payeeKey, (v.to.get(payeeKey) ?? 0) + 1);
            aliasVotes.set(k, v);
        }
        const key = (0, name_memory_util_1.descriptionKey)(row.description);
        if (!key)
            continue;
        const cats = realCategories(t);
        const outcome = `${payeeKey}\u0000${cats.length === 1 ? cats[0] : ''}`;
        const d = descVotes.get(key) ?? {
            example: row.description,
            outcomes: new Map(),
            rows: [],
        };
        d.outcomes.set(outcome, (d.outcomes.get(outcome) ?? 0) + 1);
        d.rows.push(row);
        descVotes.set(key, d);
    }
    const aliasOf = new Map();
    for (const [k, v] of aliasVotes) {
        if (v.to.size === 1)
            aliasOf.set(k, [...v.to.keys()][0]);
    }
    const names = [];
    const nameIdOf = new Map();
    for (const [key, acc] of payees) {
        const categories = [...acc.categories]
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
        const id = `n${names.length + 1}`;
        nameIdOf.set(key, id);
        const aliases = [...aliasOf]
            .filter(([, to]) => to === key)
            .map(([from]) => aliasVotes.get(from).spelling)
            .sort((a, b) => a.localeCompare(b));
        names.push({
            id,
            payee: payeeName(key),
            categories,
            category: categories.length === 1 ? categories[0].category : null,
            split: false,
            aliases,
            descriptions: [],
            count: acc.count,
            skip: categories.length === 0 && aliases.length === 0,
        });
    }
    const descriptions = [];
    const questions = [];
    const ask = (q) => {
        questions.push({ ...q, id: `q${questions.length + 1}` });
    };
    for (const [key, d] of descVotes) {
        const outcomes = [...d.outcomes].sort((a, b) => b[1] - a[1]);
        const payeeKeys = new Set(outcomes.map(([o]) => o.split('\u0000')[0]));
        if (payeeKeys.size === 1) {
            const [only] = payeeKeys;
            const cats = outcomes.map(([o]) => o.split('\u0000')[1]).filter(Boolean);
            const name = names.find((n) => n.id === nameIdOf.get(only));
            if (name && new Set(cats).size === 1 && cats.length === outcomes.length) {
                name.descriptions.push({
                    key,
                    example: d.example,
                    category: cats[0],
                    count: d.rows.length,
                });
            }
        }
        const reached = d.rows.every((r) => {
            if (!r.name)
                return false;
            const k = (0, exports.nameKey)(r.name);
            return payeeKeys.has(aliasOf.get(k) ?? k);
        });
        if (reached && payeeKeys.size === 1)
            continue;
        if (payeeKeys.size === 1) {
            const [only] = payeeKeys;
            const cat = outcomes[0][0].split('\u0000')[1] || null;
            descriptions.push({
                id: `d${descriptions.length + 1}`,
                key,
                example: d.example,
                payee: payeeName(only),
                category: cat,
                count: d.rows.length,
                skip: false,
            });
            continue;
        }
        const byPayee = new Map();
        for (const [o, n] of outcomes) {
            const p = o.split('\u0000')[0];
            byPayee.set(p, (byPayee.get(p) ?? 0) + n);
        }
        const choices = {};
        const options = [...byPayee]
            .sort((a, b) => b[1] - a[1])
            .map(([p, n], i) => {
            const value = `c${i + 1}`;
            const cat = names.find((x) => x.id === nameIdOf.get(p))?.category ?? null;
            choices[value] = { payee: payeeName(p), category: cat };
            return { value, label: payeeName(p), detail: plural(n, 'transaction') };
        });
        ask({
            kind: 'DESCRIPTION_CONFLICT',
            title: `“${d.example}” went to ${byPayee.size} different payees in QuickBooks. Which one should it be?`,
            detail: null,
            options: [
                ...options,
                { value: exports.SKIP, label: 'No rule for this description' },
            ],
            target: { type: 'description-choice', key, example: d.example },
            choices,
        });
    }
    for (const n of names) {
        if (n.categories.length < 2)
            continue;
        ask({
            kind: 'NAME_CATEGORIES',
            title: `${n.payee} was filed under ${n.categories.length} categories in QuickBooks. Which should it be?`,
            detail: 'A name has one category in our books. Pick one, or split it into sub-names ' +
                `(one per category) — QuickBooks then gets it as “${n.payee}-mix”.`,
            options: [
                ...n.categories.map((c) => ({
                    value: c.category,
                    label: c.category,
                    detail: plural(c.count, 'transaction'),
                })),
                {
                    value: exports.SPLIT,
                    label: 'Split into sub-names',
                    detail: n.categories
                        .map((c) => `${n.payee} - ${c.category}`)
                        .join(', '),
                },
                { value: exports.SKIP, label: 'No rule for this name' },
            ],
            target: { type: 'name', id: n.id },
        });
    }
    const nameRules = rules.filter((r) => r.matchType === 'NAME');
    for (const n of names) {
        for (const alias of n.aliases) {
            const theirs = nameRules.find((r) => r.matchKey === (0, exports.nameKey)(alias) && r.name);
            if (theirs && (0, exports.nameKey)(theirs.name) !== (0, exports.nameKey)(n.payee)) {
                ask({
                    kind: 'RULE_CONFLICT',
                    title: `Your rule renames “${alias}” to “${theirs.name}”. QuickBooks calls it “${n.payee}”.`,
                    detail: null,
                    options: [
                        { value: exports.OURS, label: `Keep “${theirs.name}”` },
                        { value: exports.QBO, label: `Use “${n.payee}”` },
                    ],
                    target: { type: 'alias', id: n.id, alias },
                });
            }
        }
        if (!n.categories.length)
            continue;
        const theirs = nameRules.find((r) => r.category &&
            ((r.name && (0, exports.nameKey)(r.name) === (0, exports.nameKey)(n.payee)) ||
                (!r.name && r.matchKey === (0, exports.nameKey)(n.payee))));
        const wanted = n.category ?? n.categories[0].category;
        if (theirs && theirs.category.toLowerCase() !== wanted.toLowerCase()) {
            ask({
                kind: 'RULE_CONFLICT',
                title: `Your rule files ${n.payee} under “${theirs.category}”. QuickBooks used “${wanted}”.`,
                detail: n.categories.length > 1
                    ? 'If you keep yours, the category question for this name is not used.'
                    : null,
                options: [
                    { value: exports.OURS, label: `Keep “${theirs.category}”` },
                    { value: exports.QBO, label: `Use QuickBooks' category` },
                ],
                target: { type: 'name-category', id: n.id },
            });
        }
    }
    for (const d of descriptions) {
        const theirs = rules.find((r) => r.matchType === 'DESCRIPTION' && r.matchKey === d.key && r.name);
        if (theirs && (0, exports.nameKey)(theirs.name) !== (0, exports.nameKey)(d.payee)) {
            ask({
                kind: 'RULE_CONFLICT',
                title: `Your rule names “${d.example}” “${theirs.name}”. QuickBooks used “${d.payee}”.`,
                detail: null,
                options: [
                    { value: exports.OURS, label: `Keep “${theirs.name}”` },
                    { value: exports.QBO, label: `Use “${d.payee}”` },
                ],
                target: { type: 'description', id: d.id },
            });
        }
    }
    const categories = new Map();
    for (const t of txns)
        for (const l of t.lines)
            if (!categories.has(l.category))
                categories.set(l.category, l.categoryType);
    return {
        since: input.since,
        stats: {
            qboTransactions: txns.length,
            bookRows: rows.length,
            matched: matches.size,
            payees: payees.size,
        },
        names: names.sort((a, b) => b.count - a.count || a.payee.localeCompare(b.payee)),
        descriptions,
        questions,
        categories: [...categories].map(([name, type]) => ({ name, type })),
    };
}
function accountTypeOf(qboType) {
    const t = (qboType ?? '').toLowerCase();
    if (/income/.test(t))
        return 'INCOME';
    if (/equity/.test(t))
        return 'EQUITY';
    if (/(credit card|liabilit|payable)/.test(t))
        return 'LIABILITY';
    if (/(bank|asset|receivable)/.test(t))
        return 'ASSET';
    return 'EXPENSE';
}
const isUncategorizedQbo = (name) => UNCATEGORIZED_QBO.test(name.trim());
exports.isUncategorizedQbo = isUncategorizedQbo;
//# sourceMappingURL=qbo-import.util.js.map