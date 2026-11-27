"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIX_SUFFIX = exports.UNCATEGORIZED_INCOME = exports.UNCATEGORIZED_EXPENSE = void 0;
exports.familyLines = familyLines;
exports.qboTypeOf = qboTypeOf;
exports.qboCategoryName = qboCategoryName;
exports.qboAccountType = qboAccountType;
exports.qboText = qboText;
exports.qboPayeeName = qboPayeeName;
exports.repointEntity = repointEntity;
exports.qboQuote = qboQuote;
exports.familyHash = familyHash;
exports.qboBody = qboBody;
const node_crypto_1 = require("node:crypto");
exports.UNCATEGORIZED_EXPENSE = 'Uncategorized Expense';
exports.UNCATEGORIZED_INCOME = 'Uncategorized Income';
const cents = (n) => Math.round(n * 100);
function familyLines(parent, splits) {
    const total = Math.abs(cents(parent.amount));
    const withClass = (c, customer) => ({
        ...(c ? { className: c } : {}),
        ...(customer ? { customerName: customer } : {}),
    });
    const parts = splits.map((s) => ({
        category: s.category,
        cents: Math.abs(cents(s.amount)),
        description: s.description,
        ...withClass(s.className || parent.className, s.customerName || parent.customerName),
    }));
    const taken = parts.reduce((sum, p) => sum + p.cents, 0);
    const lines = [];
    if (total - taken > 0) {
        lines.push({
            category: parent.category,
            cents: total - taken,
            description: parent.description,
            ...withClass(parent.className, parent.customerName),
        });
    }
    for (const p of parts)
        if (p.cents > 0)
            lines.push(p);
    return lines;
}
function qboTypeOf(family) {
    if (family.cents < 0)
        return 'Purchase';
    return family.kind === 'CREDIT_CARD' ? 'Purchase' : 'Deposit';
}
function qboCategoryName(category, moneyOut) {
    if (category === 'Uncategorized') {
        return moneyOut ? exports.UNCATEGORIZED_EXPENSE : exports.UNCATEGORIZED_INCOME;
    }
    return qboText(category);
}
function qboAccountType(name, type) {
    if (name === exports.UNCATEGORIZED_EXPENSE)
        return { AccountType: 'Expense' };
    if (name === exports.UNCATEGORIZED_INCOME)
        return { AccountType: 'Income' };
    switch (type) {
        case 'INCOME':
            return { AccountType: 'Income' };
        case 'ASSET':
            return { AccountType: 'Other Current Asset' };
        case 'LIABILITY':
            return { AccountType: 'Other Current Liability' };
        case 'EQUITY':
            return { AccountType: 'Equity' };
        case 'EXPENSE':
            return { AccountType: 'Expense' };
    }
}
function qboText(value, max = 100) {
    return value
        .replace(/[:\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, max)
        .trim();
}
exports.MIX_SUFFIX = '-mix';
function qboPayeeName(name, mixed) {
    if (!mixed)
        return qboText(name);
    return `${qboText(name, 100 - exports.MIX_SUFFIX.length)}${exports.MIX_SUFFIX}`;
}
const refId = (ref) => {
    const v = ref?.value;
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};
function repointEntity(type, txn, fromId, to) {
    const syncToken = typeof txn.SyncToken === 'string' ? { SyncToken: txn.SyncToken } : {};
    const ref = { value: to.id, type: to.type };
    if (type === 'Purchase') {
        if (refId(txn.EntityRef) !== fromId)
            return null;
        return { ...syncToken, EntityRef: ref };
    }
    const lines = Array.isArray(txn.Line)
        ? txn.Line
        : [];
    let changed = false;
    const Line = lines.map((line) => {
        const detail = line.DepositLineDetail;
        if (!detail || refId(detail.Entity) !== fromId)
            return line;
        changed = true;
        return { ...line, DepositLineDetail: { ...detail, Entity: ref } };
    });
    return changed ? { ...syncToken, Line } : null;
}
function qboQuote(value) {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
function familyHash(family) {
    const key = {
        type: qboTypeOf(family),
        date: family.date,
        cents: family.cents,
        name: family.name,
        account: family.plaidAccountId,
        lines: family.lines.map((l) => {
            const key = l.className
                ? [l.category, l.cents, l.description, l.className]
                : [l.category, l.cents, l.description];
            if (l.customerName)
                key.push({ customer: l.customerName });
            return key;
        }),
        ...(family.fields?.length
            ? { fields: family.fields.map((f) => [f.ref, f.value]) }
            : {}),
        ...(family.location ? { location: family.location } : {}),
    };
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(key)).digest('hex');
}
const money = (c) => Number((c / 100).toFixed(2));
function qboBody(family, refs, omit = {}) {
    const moneyOut = family.cents < 0;
    const note = qboText(`${family.description} · bank feed ${family.externalId}`, 4000);
    const accountOf = (category) => {
        const id = refs.accountIds.get(qboCategoryName(category, moneyOut));
        if (!id)
            throw new Error(`No QuickBooks account for "${category}"`);
        return id;
    };
    const classRef = (l) => {
        const id = !omit.classes && l.className
            ? refs.classIds?.get(l.className)
            : undefined;
        return id ? { ClassRef: { value: id } } : {};
    };
    const custom = !omit.fields && family.fields?.length
        ? {
            CustomField: family.fields.map((f) => ({
                DefinitionId: f.ref,
                Type: 'StringType',
                StringValue: f.value.slice(0, 255),
            })),
        }
        : {};
    const department = !omit.locations && refs.departmentId
        ? { DepartmentRef: { value: refs.departmentId } }
        : {};
    const customerRef = (l) => {
        const id = !omit.customers && l.customerName
            ? refs.customerIds?.get(l.customerName)
            : undefined;
        return id ? { CustomerRef: { value: id } } : {};
    };
    if (qboTypeOf(family) === 'Deposit') {
        return {
            DepositToAccountRef: { value: refs.bankAccountId },
            TxnDate: family.date,
            PrivateNote: note,
            ...custom,
            ...department,
            Line: family.lines.map((l) => ({
                DetailType: 'DepositLineDetail',
                Amount: money(l.cents),
                ...(l.description ? { Description: qboText(l.description, 4000) } : {}),
                DepositLineDetail: {
                    AccountRef: { value: accountOf(l.category) },
                    ...(refs.entity
                        ? { Entity: { value: refs.entity.id, type: refs.entity.type } }
                        : {}),
                    ...classRef(l),
                },
            })),
        };
    }
    return {
        PaymentType: family.kind === 'CREDIT_CARD' ? 'CreditCard' : 'Cash',
        AccountRef: { value: refs.bankAccountId },
        TxnDate: family.date,
        PrivateNote: note,
        ...(!moneyOut ? { Credit: true } : {}),
        ...(refs.entity
            ? { EntityRef: { value: refs.entity.id, type: refs.entity.type } }
            : {}),
        ...custom,
        ...department,
        Line: family.lines.map((l) => ({
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: money(l.cents),
            ...(l.description ? { Description: qboText(l.description, 4000) } : {}),
            AccountBasedExpenseLineDetail: {
                AccountRef: { value: accountOf(l.category) },
                ...classRef(l),
                ...customerRef(l),
            },
        })),
    };
}
//# sourceMappingURL=qbo-mapping.util.js.map