"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSubName = ensureSubName;
exports.copyParentPicks = copyParentPicks;
exports.wrapperNames = wrapperNames;
exports.refuseWrapper = refuseWrapper;
exports.fileUnderSubNames = fileUnderSubNames;
exports.ledgerNameId = ledgerNameId;
exports.dropUnusedSubName = dropUnusedSubName;
exports.deleteSubName = deleteSubName;
exports.syncParentSubNames = syncParentSubNames;
const common_1 = require("@nestjs/common");
const attachment_name_util_1 = require("./attachment-name.util");
const name_memory_util_1 = require("./name-memory.util");
const scope_1 = require("./scope");
const sub_names_util_1 = require("./sub-names.util");
async function ensureSubName(prisma, scope, parent, category, copyPicks = true) {
    const nameId = await ledgerNameId(prisma, scope, parent);
    const found = await prisma.subName.findFirst({
        where: { bookId: scope.bookId, nameId, category },
        select: { id: true, name: true },
    });
    if (found)
        return found;
    const made = await prisma.subName.create({
        data: {
            ...(0, scope_1.scopeWhere)(scope),
            nameId,
            name: (0, sub_names_util_1.subNameOf)(parent, category),
            category,
            ownAgencies: true,
        },
        select: { id: true, name: true },
    });
    if (copyPicks)
        await copyParentPicks(prisma, scope, parent, made.name);
    return made;
}
async function copyParentPicks(prisma, scope, parent, sub) {
    const [picks, theirs] = await Promise.all([
        prisma.ledgerNameAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: (0, name_memory_util_1.cleanName)(parent) ?? parent },
            select: { agencyId: true, lineName: true, appliedAt: true },
        }),
        prisma.ledgerNameAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: sub },
            select: { agencyId: true },
        }),
    ]);
    const has = new Set(theirs.map((t) => t.agencyId));
    const data = picks
        .filter((p) => !has.has(p.agencyId))
        .map((p) => ({ ...(0, scope_1.scopeWhere)(scope), name: sub, ...p }));
    if (data.length)
        await prisma.ledgerNameAgency.createMany({ data });
}
async function wrapperNames(prisma, scope) {
    const subs = await prisma.subName.findMany({
        where: { bookId: scope.bookId },
        select: { nameId: true },
        distinct: ['nameId'],
    });
    if (!subs.length)
        return new Map();
    const names = await prisma.ledgerName.findMany({
        where: { id: { in: subs.map((s) => s.nameId) } },
        select: { id: true, name: true },
    });
    return new Map(names.map((n) => [(0, attachment_name_util_1.nameKeyOf)(n.name), n.id]));
}
async function refuseWrapper(prisma, scope, name) {
    const clean = (0, name_memory_util_1.cleanName)(name);
    if (!clean)
        return;
    const found = await prisma.ledgerName.findFirst({
        where: { ...(0, scope_1.scopeWhere)(scope), name: clean },
        select: { id: true },
    });
    if (!found)
        return;
    const subs = await prisma.subName.count({
        where: { bookId: scope.bookId, nameId: found.id },
    });
    if (subs)
        throw new common_1.BadRequestException(`“${clean}” is a group of its sub-names — change one of its sub-names instead`);
}
async function fileUnderSubNames(prisma, scope) {
    const wrappers = await wrapperNames(prisma, scope);
    if (!wrappers.size)
        return 0;
    const names = await prisma.ledgerName.findMany({
        where: { id: { in: [...wrappers.values()] } },
        select: { name: true },
    });
    const rows = await prisma.bankTransaction.findMany({
        where: {
            ...(0, scope_1.scopeWhere)(scope),
            splitRuleId: null,
            name: { in: names.map((n) => n.name) },
        },
        select: { id: true, name: true, offsetAccount: true, subNameId: true },
    });
    const subIds = [
        ...new Set(rows.flatMap((r) => (r.subNameId ? [r.subNameId] : []))),
    ];
    const subs = subIds.length
        ? await prisma.subName.findMany({
            where: { id: { in: subIds } },
            select: { id: true, nameId: true, category: true },
        })
        : [];
    const plan = (0, sub_names_util_1.subNameFiling)(rows.map((r) => ({ ...r, category: r.offsetAccount })), wrappers, new Map(subs.map((s) => [s.id, s])));
    if (!plan.length)
        return 0;
    const groups = new Map();
    for (const p of plan) {
        const k = `${(0, attachment_name_util_1.nameKeyOf)(p.name)}\u0000${p.category}`;
        const g = groups.get(k) ?? { name: p.name, category: p.category, ids: [] };
        g.ids.push(p.id);
        groups.set(k, g);
    }
    const before = new Map(rows.map((r) => [r.id, r.subNameId]));
    for (const g of groups.values()) {
        const sub = await ensureSubName(prisma, scope, g.name, g.category);
        await prisma.bankTransaction.updateMany({
            where: { id: { in: g.ids } },
            data: { subNameId: sub.id },
        });
    }
    const left = new Set(plan.flatMap((p) => {
        const was = before.get(p.id);
        return was ? [was] : [];
    }));
    for (const id of left)
        await dropUnusedSubName(prisma, scope, id);
    return plan.length;
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
async function dropUnusedSubName(prisma, scope, id) {
    if (!id)
        return;
    const used = await prisma.bankTransaction.count({
        where: { bookId: scope.bookId, subNameId: id },
    });
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
        prisma.customerNameRule.updateMany({
            where: { bookId: sub.bookId, subNameId: id },
            data: { subNameId: null, category: null },
        }),
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
                { splits: { some: { splitRuleId: null } } },
                { splits: { some: { subNameId: { not: null } } } },
            ],
        },
        select: {
            id: true,
            name: true,
            offsetAccount: true,
            subNameId: true,
            personalRuleId: true,
            splits: {
                where: { OR: [{ splitRuleId: null }, { subNameId: { not: null } }] },
                select: { id: true },
            },
        },
    });
    if (!parents.length) {
        await fileUnderSubNames(prisma, scope);
        return 0;
    }
    const wrappers = await wrapperNames(prisma, scope);
    const ruleIds = [
        ...new Set(parents.flatMap((p) => (p.personalRuleId ? [p.personalRuleId] : []))),
    ];
    const subRules = ruleIds.length
        ? await prisma.customerNameRule.findMany({
            where: { id: { in: ruleIds }, subNameId: { not: null } },
            select: { id: true, subNameId: true },
        })
        : [];
    const ruleSub = new Map(subRules.map((r) => [r.id, r.subNameId]));
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
            hasSplits: p.splits.length > 0,
            nameHasSubs: !!p.name && wrappers.has((0, attachment_name_util_1.nameKeyOf)(p.name)),
            current: sub && parent ? { parent, category: sub.category } : null,
            fromRule: p.subNameId !== null &&
                p.personalRuleId !== null &&
                ruleSub.get(p.personalRuleId) === p.subNameId,
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
            where: { bookId: scope.bookId, subNameId: id },
        });
        if (!used)
            await deleteSubName(prisma, id);
    }
    return changed + (await fileUnderSubNames(prisma, scope));
}
//# sourceMappingURL=sub-name-parents.js.map