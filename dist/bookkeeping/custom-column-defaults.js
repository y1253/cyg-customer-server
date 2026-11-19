"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultFor = defaultFor;
exports.fillNameAnswers = fillNameAnswers;
exports.moveNameAnswers = moveNameAnswers;
const common_1 = require("@nestjs/common");
const scope_1 = require("./scope");
const logger = new common_1.Logger('CustomColumnDefaults');
function defaultFor(defaults, columnId, row) {
    const mine = defaults.filter((d) => d.columnId === columnId);
    if (row.subNameId !== null) {
        const sub = mine.find((d) => d.subNameId === row.subNameId);
        if (sub)
            return sub;
    }
    const key = row.name?.toLowerCase() ?? null;
    return (key !== null && mine.find((d) => d.nameKey === key)) || null;
}
async function fillNameAnswers(prisma, scope, target = {}) {
    try {
        const rows = await prisma.customColumnNameAnswer.findMany({
            where: {
                column: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                OR: [{ dropDownId: null }, { dropDown: { deletedAt: null } }],
            },
            select: {
                customColumnId: true,
                nameId: true,
                subNameId: true,
                value: true,
                dropDownId: true,
                column: { select: { type: true } },
            },
        });
        const usable = rows.filter((r) => r.column.type !== 'DROPDOWN' || r.dropDownId !== null);
        if (!usable.length)
            return 0;
        const nameIds = [
            ...new Set(usable.flatMap((r) => (r.nameId === null ? [] : [r.nameId]))),
        ];
        const names = nameIds.length
            ? await prisma.ledgerName.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), id: { in: nameIds } },
                select: { id: true, name: true },
            })
            : [];
        const keyOf = new Map(names.map((n) => [n.id, n.name.toLowerCase()]));
        const defaults = usable.flatMap((r) => {
            const nameKey = r.nameId === null ? null : keyOf.get(r.nameId);
            if (nameKey === undefined)
                return [];
            return [
                {
                    columnId: r.customColumnId,
                    nameKey,
                    subNameId: r.subNameId,
                    value: r.value,
                    dropDownId: r.dropDownId,
                },
            ];
        });
        if (!defaults.length)
            return 0;
        let ids = target.transactionIds;
        if (ids) {
            const own = await prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), id: { in: ids } },
                select: { id: true, splitOfId: true },
            });
            ids = [...new Set(own.map((r) => r.splitOfId ?? r.id))];
            if (!ids.length)
                return 0;
        }
        const or = [
            ...(target.names?.length ? [{ name: { in: target.names } }] : []),
            ...(target.subNameIds?.length
                ? [{ subNameId: { in: target.subNameIds } }]
                : []),
        ];
        if ((target.names || target.subNameIds) && !or.length)
            return 0;
        const txs = await prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: null,
                statement: { deletedAt: null },
                ...(ids && { id: { in: ids } }),
                ...(or.length && { OR: or }),
                NOT: { AND: [{ name: null }, { subNameId: null }] },
            },
            select: { id: true, name: true, subNameId: true },
        });
        const columns = [...new Set(defaults.map((d) => d.columnId))];
        const data = txs.flatMap((t) => columns.flatMap((columnId) => {
            const d = defaultFor(defaults, columnId, t);
            return d
                ? [
                    {
                        customColumnId: columnId,
                        transactionId: t.id,
                        value: d.value,
                        dropDownId: d.dropDownId,
                    },
                ]
                : [];
        }));
        if (!data.length)
            return 0;
        let filled = 0;
        for (let i = 0; i < data.length; i += 1000) {
            const r = await prisma.customColumnAnswer.createMany({
                data: data.slice(i, i + 1000),
                skipDuplicates: true,
            });
            filled += r.count;
        }
        return filled;
    }
    catch (err) {
        logger.warn(`book ${scope.bookId}: name default answers not filled: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
    }
}
async function moveNameAnswers(prisma, from, to, remove = false) {
    const keyOf = (k) => ({
        nameId: k.nameId ?? null,
        subNameId: k.subNameId ?? null,
    });
    const src = await prisma.customColumnNameAnswer.findMany({
        where: keyOf(from),
    });
    if (!src.length)
        return;
    const dst = keyOf(to);
    const have = await prisma.customColumnNameAnswer.findMany({
        where: dst,
        select: { customColumnId: true },
    });
    const taken = new Set(have.map((h) => h.customColumnId));
    const add = src.filter((s) => !taken.has(s.customColumnId));
    await prisma.$transaction([
        ...(add.length
            ? [
                prisma.customColumnNameAnswer.createMany({
                    data: add.map((s) => ({
                        customColumnId: s.customColumnId,
                        ...dst,
                        value: s.value,
                        dropDownId: s.dropDownId,
                    })),
                }),
            ]
            : []),
        ...(remove
            ? [
                prisma.customColumnNameAnswer.deleteMany({
                    where: { id: { in: src.map((s) => s.id) } },
                }),
            ]
            : []),
    ]);
}
//# sourceMappingURL=custom-column-defaults.js.map