"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isActive = void 0;
exports.passes = passes;
exports.compare = compare;
exports.applyTable = applyTable;
exports.queryLedger = queryLedger;
exports.pageOfFamilies = pageOfFamilies;
const name_memory_util_1 = require("./name-memory.util");
const reports_util_1 = require("./reports.util");
const isActive = (f) => !!f &&
    (!!f.text?.trim() ||
        (f.min !== undefined && f.min !== null) ||
        (f.max !== undefined && f.max !== null) ||
        !!f.from ||
        !!f.to);
exports.isActive = isActive;
function passes(def, f, row) {
    if (!(0, exports.isActive)(f))
        return true;
    const v = def.value(row);
    if (def.kind === 'text') {
        const q = f.text?.trim().toLowerCase() ?? '';
        return !q || (v === null ? '' : String(v).toLowerCase()).includes(q);
    }
    if (def.kind === 'number') {
        if (typeof v !== 'number' || Number.isNaN(v))
            return false;
        if (f.min !== undefined && f.min !== null && v < f.min)
            return false;
        if (f.max !== undefined && f.max !== null && v > f.max)
            return false;
        return true;
    }
    const d = typeof v === 'string' ? v.slice(0, 10) : '';
    if (!d)
        return false;
    if (f.from && d < f.from)
        return false;
    if (f.to && d > f.to)
        return false;
    return true;
}
function compare(def, a, b, dir) {
    const xa = def.value(a);
    const xb = def.value(b);
    const emptyA = xa === null || xa === undefined || xa === '';
    const emptyB = xb === null || xb === undefined || xb === '';
    if (emptyA || emptyB)
        return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
    const c = typeof xa === 'number' && typeof xb === 'number'
        ? xa - xb
        : String(xa).localeCompare(String(xb), undefined, {
            sensitivity: 'base',
            numeric: true,
        });
    return dir === 'asc' ? c : -c;
}
function applyTable(rows, defs, filters, sort) {
    const active = defs.filter((d) => (0, exports.isActive)(filters[d.key]));
    const kept = active.length
        ? rows.filter((r) => active.every((d) => passes(d, filters[d.key], r)))
        : rows;
    const def = sort && defs.find((d) => d.key === sort.key);
    if (!def)
        return kept;
    return kept
        .map((r, i) => ({ r, i }))
        .sort((a, b) => compare(def, a.r, b.r, sort.dir) || a.i - b.i)
        .map((x) => x.r);
}
const cents = (n) => Math.round(n * 100);
const nameOf = (t) => t.kind === 'opening' ? null : (t.name ?? reports_util_1.UNCLARIFIED_NAME);
function queryLedger(all, query, ctx) {
    const splitCents = new Map();
    for (const t of all)
        if (t.kind === 'split') {
            const top = t.splitOfId ?? t.id;
            splitCents.set(top, (splitCents.get(top) ?? 0) + cents(t.amount));
        }
    const fullOf = (t) => !t.kind && splitCents.has(t.id)
        ? (cents(t.amount) + splitCents.get(t.id)) / 100
        : t.amount;
    const ranged = !!(query.from || query.to);
    const inRange = (t) => {
        if (!ranged)
            return true;
        const day = (t.postingDate ?? t.pendingDate)?.slice(0, 10) ??
            ctx.periodEnd.get(t.statementId) ??
            null;
        return (!!day &&
            (!query.from || day >= query.from) &&
            (!query.to || day <= query.to));
    };
    const q = query.q?.trim().toLowerCase() ?? '';
    const statements = query.statementIds?.length
        ? new Set(query.statementIds)
        : null;
    const wantedDescription = query.description
        ? (0, name_memory_util_1.descriptionKey)(query.description)
        : null;
    const kept = all.filter((t) => (query.focusId == null ||
        t.id === query.focusId ||
        t.splitOfId === query.focusId) &&
        (!statements || statements.has(t.statementId)) &&
        inRange(t) &&
        (!query.account ||
            t.debitAccount === query.account ||
            t.creditAccount === query.account) &&
        (wantedDescription === null ||
            (0, name_memory_util_1.descriptionKey)(t.description) === wantedDescription) &&
        (!query.near || !t.kind || t.kind === 'split') &&
        (!q ||
            t.description.toLowerCase().includes(q) ||
            (!!query.near &&
                Math.abs(t.amount)
                    .toFixed(2)
                    .includes(q.replace(/[$,\s-]/g, ''))) ||
            !!t.name?.toLowerCase().includes(q) ||
            !!t.itemName?.toLowerCase().includes(q) ||
            t.debitAccount.toLowerCase().includes(q) ||
            t.creditAccount.toLowerCase().includes(q)));
    let groups = [];
    const at = new Map();
    for (const t of kept) {
        const top = t.kind === 'split' ? (t.splitOfId ?? t.id) : null;
        const g = top !== null ? at.get(top) : undefined;
        if (g) {
            g.push(t);
            continue;
        }
        const fresh = [t];
        groups.push(fresh);
        if (!t.kind || t.kind === 'split')
            at.set(top ?? t.id, fresh);
    }
    const wanted = query.name?.trim().toLowerCase();
    if (wanted)
        groups = groups.filter((g) => g.some((t) => nameOf(t)?.toLowerCase() === wanted));
    if (query.subNameId != null)
        groups = groups
            .map((g) => g.filter((t) => t.subName?.id === query.subNameId))
            .filter((g) => g.length > 0);
    const columns = [
        { key: 'date', kind: 'date', value: (t) => t.postingDate ?? t.pendingDate },
        { key: 'name', kind: 'text', value: nameOf },
        { key: 'description', kind: 'text', value: (t) => t.description },
        { key: 'product', kind: 'text', value: (t) => t.itemName ?? null },
        {
            key: 'amount',
            kind: 'number',
            value: (t) => (query.folded ? fullOf(t) : t.amount),
        },
        { key: 'debit', kind: 'text', value: (t) => t.debitAccount },
        { key: 'credit', kind: 'text', value: (t) => t.creditAccount },
        { key: 'statement', kind: 'text', value: (t) => t.statementLabel },
        ...(ctx.columns ?? []).map((c) => ({
            key: `c${c.id}`,
            kind: c.type === 'NUMBER' ? 'number' : 'text',
            value: (t) => {
                const v = (t.kind && t.kind !== 'split') || !ctx.answerText
                    ? null
                    : ctx.answerText(c.id, t.id);
                return c.type === 'NUMBER'
                    ? v == null || v === ''
                        ? null
                        : Number(v.replace(',', '.'))
                    : v;
            },
        })),
    ];
    const heads = groups.map((g) => ({
        head: g.find((t) => !t.kind) ?? g[0],
        g,
    }));
    const byHead = new Map(heads.map((h) => [h.head, h.g]));
    let sortedHeads = applyTable(heads.map((h) => h.head), columns, query.filters ?? {}, query.sort ?? null);
    const near = query.near;
    if (near) {
        const want = near.amount != null ? cents(Math.abs(near.amount)) : null;
        const day = near.date ? Date.parse(near.date) : null;
        const score = (t) => {
            const off = want != null ? Math.abs(Math.abs(cents(fullOf(t))) - want) : 0;
            const date = t.postingDate ?? t.pendingDate;
            const gap = day != null && date ? Math.abs(Date.parse(date) - day) / 86_400_000 : 0;
            return off * 10 + gap;
        };
        sortedHeads = sortedHeads
            .filter((t) => !t.kind)
            .map((t, i) => ({ t, i, s: score(t) }))
            .sort((a, b) => a.s - b.s || a.i - b.i)
            .map((x) => x.t);
    }
    const ordered = sortedHeads.map((head) => byHead.get(head) ?? [head]);
    const families = ordered.map((g) => g.map((t) => !t.kind && splitCents.has(t.id) ? { ...t, fullAmount: fullOf(t) } : t));
    const rows = ordered.flat();
    const foreign = rows.some((t) => t.currency);
    const homeCents = (t) => t.kind === 'fx'
        ? cents(t.homeAmount ?? 0)
        : t.currency && t.fxRate != null
            ? Math.round(cents(t.amount) * t.fxRate)
            : cents(t.amount);
    const byCategory = new Map();
    let net = 0;
    let home = 0;
    let splitCount = 0;
    for (const t of rows) {
        if (t.kind === 'split')
            splitCount++;
        net += cents(t.amount);
        home += homeCents(t);
        const cat = byCategory.get(t.offsetAccount) ?? { rows: 0, c: 0, h: 0 };
        cat.rows++;
        cat.c += cents(t.amount);
        cat.h += homeCents(t);
        byCategory.set(t.offsetAccount, cat);
    }
    return {
        families,
        summary: {
            txCount: rows.length - splitCount,
            splitCount,
            allTx: all.filter((t) => t.kind !== 'split').length,
            net: net / 100,
            homeNet: foreign ? home / 100 : null,
            isAgency: !!query.account &&
                all.some((t) => !!t.splitRule && t.offsetAccount === query.account),
            families: families.length,
            byCategory: [...byCategory.entries()]
                .map(([category, v]) => ({
                category,
                rows: v.rows,
                total: v.c / 100,
                homeTotal: v.h / 100,
            }))
                .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) ||
                a.category.localeCompare(b.category)),
        },
    };
}
function pageOfFamilies(families, offset, limit) {
    const slice = families.slice(offset, offset + limit);
    const next = offset + slice.length;
    return {
        rows: slice.flat(),
        nextOffset: next < families.length ? next : null,
    };
}
//# sourceMappingURL=ledger-query.util.js.map