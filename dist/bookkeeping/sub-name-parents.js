"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSubName = ensureSubName;
exports.ledgerNameId = ledgerNameId;
exports.dropUnusedSubName = dropUnusedSubName;
exports.deleteSubName = deleteSubName;
exports.syncParentSubNames = syncParentSubNames;
exports.syncTaxSubNames = syncTaxSubNames;
const attachment_name_util_1 = require("./attachment-name.util");
const name_memory_util_1 = require("./name-memory.util");
const reports_util_1 = require("./reports.util");
const scope_1 = require("./scope");
const sub_names_util_1 = require("./sub-names.util");
async function ensureSubName(prisma, scope, parent, category) {
    const nameId = await ledgerNameId(prisma, scope, parent);
    const found = await prisma.subName.findFirst({
        where: { bookId: scope.bookId, nameId, category },
        select: { id: true, name: true },
    });
    if (found)
        return found;
    return prisma.subName.create({
        data: {
            ...(0, scope_1.scopeWhere)(scope),
            nameId,
            name: (0, sub_names_util_1.subNameOf)(parent, category),
            category,
        },
        select: { id: true, name: true },
    });
}
async function ledgerNameId(prisma, scope, name) {
    const clean = (0, name_memory_util_1.cleanName)(name) ?? name;
    const found = await prisma.ledgerName.findFirst({
        where: { ...(0, scope_1.scopeWhere)(scope), name: clean },
        select: { id: true },
    });
    if (found)
        return found.id;
    const made = await prisma.ledgerName.create({
        data: { ...(0, scope_1.scopeWhere)(scope), name: clean },
        select: { id: true },
    });
    return made.id;
}
async function dropUnusedSubName(prisma, id) {
    if (!id)
        return;
    const used = await prisma.bankTransaction.count({ where: { subNameId: id } });
    if (!used)
        await deleteSubName(prisma, id);
}
async function deleteSubName(prisma, id) {
    const sub = await prisma.subName.findUnique({ where: { id } });
    if (!sub)
        return;
    const parent = await prisma.ledgerName.findUnique({
        where: { id: sub.nameId },
        select: { name: true },
    });
    await prisma.$transaction([
        prisma.ledgerNameAgency.deleteMany({
            where: { bookId: sub.bookId, name: sub.name },
        }),
        ...(parent
            ? [
                prisma.transactionAttachment.updateMany({
                    where: { bookId: sub.bookId, nameOverride: sub.name },
                    data: { nameOverride: parent.name },
                }),
                prisma.nameFolder.updateMany({
                    where: { bookId: sub.bookId, name: (0, attachment_name_util_1.nameKeyOf)(sub.name) },
                    data: { name: (0, attachment_name_util_1.nameKeyOf)(parent.name) },
                }),
            ]
            : []),
        prisma.subName.deleteMany({ where: { id } }),
    ]);
}
async function syncParentSubNames(prisma, scope, parentIds) {
    const parents = await prisma.bankTransaction.findMany({
        where: {
            ...(0, scope_1.scopeWhere)(scope),
            splitOfId: null,
            ...(parentIds && { id: { in: parentIds } }),
            OR: [
                { subNameId: { not: null } },
                { splits: { some: { subNameId: { not: null } } } },
            ],
        },
        select: {
            id: true,
            name: true,
            offsetAccount: true,
            subNameId: true,
            splits: { where: { subNameId: { not: null } }, select: { id: true } },
        },
    });
    if (!parents.length)
        return 0;
    const currentIds = [
        ...new Set(parents.flatMap((p) => (p.subNameId ? [p.subNameId] : []))),
    ];
    const subs = currentIds.length
        ? await prisma.subName.findMany({
            where: { id: { in: currentIds } },
            select: { id: true, nameId: true, category: true },
        })
        : [];
    const names = subs.length
        ? await prisma.ledgerName.findMany({
            where: { id: { in: [...new Set(subs.map((s) => s.nameId))] } },
            select: { id: true, name: true },
        })
        : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const subOf = new Map(subs.map((s) => [s.id, s]));
    const dropped = new Set();
    let changed = 0;
    for (const p of parents) {
        const sub = p.subNameId ? subOf.get(p.subNameId) : undefined;
        const parent = sub ? nameOf.get(sub.nameId) : undefined;
        const plan = (0, sub_names_util_1.parentSubName)({
            name: (0, name_memory_util_1.cleanName)(p.name),
            category: p.offsetAccount,
            hasSubSplits: p.splits.length > 0,
            current: sub && parent ? { parent, category: sub.category } : null,
        });
        if (!plan.change)
            continue;
        const next = plan.want
            ? (await ensureSubName(prisma, scope, plan.want.parent, plan.want.category)).id
            : null;
        if (next === p.subNameId)
            continue;
        await prisma.bankTransaction.update({
            where: { id: p.id },
            data: { subNameId: next },
        });
        if (p.subNameId)
            dropped.add(p.subNameId);
        changed++;
    }
    for (const id of dropped) {
        const used = await prisma.bankTransaction.count({
            where: { subNameId: id },
        });
        if (!used)
            await deleteSubName(prisma, id);
    }
    return changed;
}
async function syncTaxSubNames(prisma, scope) {
    const [picks, agencies, names, subs] = await Promise.all([
        prisma.ledgerNameAgency.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                agency: { deletedAt: null, active: true },
            },
            select: { name: true, agency: { select: { name: true } } },
        }),
        prisma.taxAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true },
        }),
        prisma.ledgerName.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true },
        }),
        prisma.subName.findMany({
            where: { bookId: scope.bookId },
            select: { id: true, nameId: true, category: true, name: true },
        }),
    ]);
    const unclarified = reports_util_1.UNCLARIFIED_NAME.toLowerCase();
    const nameOf = new Map(names.map((n) => [n.id, n.name.toLowerCase()]));
    const key = (name, category) => `${name.trim().toLowerCase()}|${category}`;
    const parentOfSub = new Map(subs.flatMap((s) => {
        const parent = names.find((n) => n.id === s.nameId)?.name;
        return parent ? [[s.name.trim().toLowerCase(), parent]] : [];
    }));
    const want = new Map();
    for (const p of picks) {
        const name = parentOfSub.get(p.name.trim().toLowerCase()) ?? p.name;
        if (!name.trim() || name.trim().toLowerCase() === unclarified)
            continue;
        want.set(key(name, p.agency.name), { name, agency: p.agency.name });
    }
    const have = new Set(subs.flatMap((s) => {
        const n = nameOf.get(s.nameId);
        return n ? [key(n, s.category)] : [];
    }));
    let made = 0;
    for (const [k, w] of want) {
        if (have.has(k))
            continue;
        await ensureSubName(prisma, scope, w.name, w.agency);
        made++;
    }
    const agencyNames = new Set(agencies.map((a) => a.name));
    const stale = subs.filter((s) => {
        const n = nameOf.get(s.nameId);
        return agencyNames.has(s.category) && !(n && want.has(key(n, s.category)));
    });
    if (stale.length) {
        const used = await prisma.bankTransaction.groupBy({
            by: ['subNameId'],
            where: { subNameId: { in: stale.map((s) => s.id) } },
        });
        const usedIds = new Set(used.map((u) => u.subNameId));
        const drop = stale.filter((s) => !usedIds.has(s.id)).map((s) => s.id);
        if (drop.length)
            await prisma.subName.deleteMany({ where: { id: { in: drop } } });
    }
    return made;
}
//# sourceMappingURL=sub-name-parents.js.map