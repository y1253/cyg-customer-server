"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomColumnsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const custom_column_defaults_1 = require("./custom-column-defaults");
const custom_column_util_1 = require("./custom-column.util");
const name_memory_util_1 = require("./name-memory.util");
const scope_1 = require("./scope");
const sub_name_parents_1 = require("./sub-name-parents");
const reports_util_1 = require("./reports.util");
let CustomColumnsService = class CustomColumnsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async view(scope) {
        const columns = await this.columns(scope);
        const rows = columns.length
            ? await this.prisma.customColumnAnswer.findMany({
                where: {
                    customColumnId: { in: columns.map((c) => c.id) },
                    transaction: {
                        ...(0, scope_1.scopeWhere)(scope),
                        statement: { deletedAt: null },
                    },
                },
                select: {
                    customColumnId: true,
                    transactionId: true,
                    value: true,
                    dropDownId: true,
                },
            })
            : [];
        const answers = {};
        for (const r of rows) {
            (answers[r.transactionId] ??= {})[r.customColumnId] = {
                value: r.value,
                dropDownId: r.dropDownId,
            };
        }
        return {
            columns,
            answers,
            nameAnswers: await this.nameAnswers(scope, columns),
            templates: await this.templates(scope),
        };
    }
    async nameAnswers(scope, columns) {
        if (!columns.length)
            return [];
        const rows = await this.prisma.customColumnNameAnswer.findMany({
            where: { customColumnId: { in: columns.map((c) => c.id) } },
            select: {
                customColumnId: true,
                nameId: true,
                subNameId: true,
                value: true,
                dropDownId: true,
            },
        });
        const nameIds = rows.flatMap((r) => (r.nameId === null ? [] : [r.nameId]));
        const names = nameIds.length
            ? await this.prisma.ledgerName.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), id: { in: nameIds } },
                select: { id: true, name: true },
            })
            : [];
        const nameOf = new Map(names.map((n) => [n.id, n.name]));
        return rows.flatMap((r) => {
            const name = r.nameId === null ? null : nameOf.get(r.nameId);
            if (name === undefined)
                return [];
            return [
                {
                    columnId: r.customColumnId,
                    name,
                    subNameId: r.subNameId,
                    value: r.value,
                    dropDownId: r.dropDownId,
                },
            ];
        });
    }
    async columns(scope) {
        const rows = await this.prisma.customColumn.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            include: {
                options: {
                    where: { deletedAt: null },
                    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                    select: { id: true, label: true },
                },
            },
        });
        return rows.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            minChars: c.minChars,
            maxChars: c.maxChars,
            required: c.required,
            options: c.options,
            qbo: c.qboKind === 'CLASS' || c.qboKind === 'FIELD' ? c.qboKind : null,
        }));
    }
    async templates(scope) {
        const rows = await this.prisma.customColumn.findMany({
            where: {
                customerId: scope.customerId,
                bookId: { not: scope.bookId },
                deletedAt: null,
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
                bookId: true,
                name: true,
                type: true,
                _count: { select: { options: { where: { deletedAt: null } } } },
            },
        });
        if (!rows.length)
            return [];
        const books = await this.prisma.book.findMany({
            where: {
                id: { in: [...new Set(rows.map((r) => r.bookId))] },
                customerId: scope.customerId,
                deletedAt: null,
            },
            select: { id: true, name: true },
        });
        return books.map((b) => ({
            bookId: b.id,
            bookName: b.name,
            columns: rows
                .filter((r) => r.bookId === b.id)
                .map((r) => ({
                name: r.name,
                type: r.type,
                options: r._count.options,
            })),
        }));
    }
    clean(input) {
        const clean = (0, custom_column_util_1.cleanColumn)(input);
        if (typeof clean === 'string')
            throw new common_1.BadRequestException(clean);
        return clean;
    }
    async nameTaken(scope, name, except) {
        const same = await this.prisma.customColumn.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { id: true, name: true },
        });
        return same.some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase());
    }
    async create(scope, input) {
        const c = this.clean(input);
        const count = await this.prisma.customColumn.count({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (count >= custom_column_util_1.MAX_CUSTOM_COLUMNS) {
            throw new common_1.BadRequestException(`A book has at most ${custom_column_util_1.MAX_CUSTOM_COLUMNS} columns of your own`);
        }
        if (await this.nameTaken(scope, c.name)) {
            throw new common_1.BadRequestException(`There is already a column “${c.name}”`);
        }
        await this.prisma.customColumn.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name: c.name,
                type: c.type,
                minChars: c.minChars,
                maxChars: c.maxChars,
                required: c.required,
                sortOrder: count,
                options: {
                    create: c.options.map((o, i) => ({ label: o.label, sortOrder: i })),
                },
            },
        });
    }
    async owned(scope, id) {
        const row = await this.prisma.customColumn.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!row)
            throw new common_1.NotFoundException('Column not found');
        return row;
    }
    async update(scope, id, input) {
        const row = await this.owned(scope, id);
        const c = this.clean(input);
        if (await this.nameTaken(scope, c.name, id)) {
            throw new common_1.BadRequestException(`There is already a column “${c.name}”`);
        }
        const had = await this.prisma.customColumnDropDown.findMany({
            where: { customColumnId: row.id, deletedAt: null },
            select: { id: true },
        });
        const keep = new Set(c.options.flatMap((o) => o.id && had.some((h) => h.id === o.id) ? [o.id] : []));
        const repoint = await this.checkAnswers(row.id, {
            ...c,
            options: c.options.map((o) => ({
                ...o,
                id: o.id && keep.has(o.id) ? o.id : undefined,
            })),
        }, new Set(had.map((h) => h.id)));
        await this.prisma.$transaction([
            this.prisma.customColumn.update({
                where: { id: row.id },
                data: {
                    name: c.name,
                    type: c.type,
                    minChars: c.minChars,
                    maxChars: c.maxChars,
                    required: c.required,
                },
            }),
            this.prisma.customColumnDropDown.updateMany({
                where: {
                    customColumnId: row.id,
                    deletedAt: null,
                    id: { notIn: [...keep] },
                },
                data: { deletedAt: new Date() },
            }),
            ...c.options.map((o, i) => o.id && keep.has(o.id)
                ? this.prisma.customColumnDropDown.update({
                    where: { id: o.id },
                    data: { label: o.label, sortOrder: i },
                })
                : this.prisma.customColumnDropDown.create({
                    data: { customColumnId: row.id, label: o.label, sortOrder: i },
                })),
        ]);
        if (c.type === 'DROPDOWN' && repoint.length) {
            const options = await this.prisma.customColumnDropDown.findMany({
                where: { customColumnId: row.id, deletedAt: null },
                select: { id: true, label: true },
            });
            for (const r of repoint) {
                const o = options.find((x) => x.label === r.label);
                if (o)
                    await this.prisma.customColumnAnswer.update({
                        where: { id: r.id },
                        data: { dropDownId: o.id, value: o.label },
                    });
            }
        }
        await this.fitNameAnswers(row.id, c);
    }
    async fitNameAnswers(columnId, col) {
        const rows = await this.prisma.customColumnNameAnswer.findMany({
            where: { customColumnId: columnId },
            select: { id: true, value: true, dropDownId: true },
        });
        if (!rows.length)
            return;
        const options = col.type === 'DROPDOWN'
            ? await this.prisma.customColumnDropDown.findMany({
                where: { customColumnId: columnId, deletedAt: null },
                select: { id: true, label: true },
            })
            : [];
        const drop = [];
        for (const r of rows) {
            const text = (r.value ?? '').trim();
            if (col.type === 'DROPDOWN') {
                if (options.some((o) => o.id === r.dropDownId))
                    continue;
                const o = options.find((x) => x.label.trim().toLowerCase() === text.toLowerCase());
                if (o && text)
                    await this.prisma.customColumnNameAnswer.update({
                        where: { id: r.id },
                        data: { dropDownId: o.id, value: o.label },
                    });
                else
                    drop.push(r.id);
            }
            else if (!text || (0, custom_column_util_1.answerProblem)(col, text))
                drop.push(r.id);
            else if (r.dropDownId !== null)
                await this.prisma.customColumnNameAnswer.update({
                    where: { id: r.id },
                    data: { dropDownId: null },
                });
        }
        if (drop.length)
            await this.prisma.customColumnNameAnswer.deleteMany({
                where: { id: { in: drop } },
            });
    }
    async checkAnswers(columnId, col, liveBefore) {
        const answers = await this.prisma.customColumnAnswer.findMany({
            where: { customColumnId: columnId },
            select: {
                id: true,
                value: true,
                dropDownId: true,
                transaction: {
                    select: {
                        id: true,
                        description: true,
                        name: true,
                        postingDate: true,
                        pendingDate: true,
                        statement: { select: { deletedAt: true } },
                    },
                },
            },
            orderBy: { transactionId: 'asc' },
        });
        const problems = [];
        const repoint = [];
        for (const a of answers) {
            if (a.transaction.statement.deletedAt)
                continue;
            const fit = (0, custom_column_util_1.storedAnswerFit)(col, a, liveBefore);
            if (fit.label)
                repoint.push({ id: a.id, label: fit.label });
            if (!fit.problem)
                continue;
            const t = a.transaction;
            const day = t.postingDate ?? t.pendingDate;
            problems.push({
                transactionId: t.id,
                date: day ? day.toISOString().slice(0, 10) : null,
                description: t.name ?? t.description,
                value: a.value ?? '',
                problem: fit.problem,
            });
        }
        if (problems.length) {
            const n = problems.length;
            throw new common_1.BadRequestException({
                statusCode: 400,
                message: `${n} answer${n === 1 ? '' : 's'} already in this column ${n === 1 ? 'does' : 'do'} not fit the new rules — fix ${n === 1 ? 'it' : 'them'} first, or keep the old rules`,
                total: n,
                problems: problems.slice(0, 50),
            });
        }
        return repoint;
    }
    async remove(scope, id) {
        const row = await this.owned(scope, id);
        await this.prisma.customColumn.update({
            where: { id: row.id },
            data: { deletedAt: new Date() },
        });
    }
    async reorder(scope, ids) {
        const mine = await this.prisma.customColumn.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, id: { in: ids } },
            select: { id: true },
        });
        const ok = new Set(mine.map((m) => m.id));
        await this.prisma.$transaction(ids
            .filter((i) => ok.has(i))
            .map((i, n) => this.prisma.customColumn.update({
            where: { id: i },
            data: { sortOrder: n },
        })));
    }
    async copy(scope, fromBookId) {
        if (fromBookId === scope.bookId)
            return 0;
        const book = await this.prisma.book.findFirst({
            where: { id: fromBookId, customerId: scope.customerId, deletedAt: null },
            select: { id: true },
        });
        if (!book)
            throw new common_1.NotFoundException('Company not found');
        const from = await this.prisma.customColumn.findMany({
            where: { customerId: scope.customerId, bookId: book.id, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            include: {
                options: {
                    where: { deletedAt: null },
                    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                },
            },
        });
        const have = await this.columns(scope);
        const taken = new Set(have.map((c) => c.name.toLowerCase()));
        let n = have.length;
        let copied = 0;
        for (const c of from) {
            if (taken.has(c.name.toLowerCase()) || n >= custom_column_util_1.MAX_CUSTOM_COLUMNS)
                continue;
            await this.prisma.customColumn.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    name: c.name,
                    type: c.type,
                    minChars: c.minChars,
                    maxChars: c.maxChars,
                    required: c.required,
                    sortOrder: n++,
                    options: {
                        create: c.options.map((o) => ({
                            label: o.label,
                            sortOrder: o.sortOrder,
                        })),
                    },
                },
            });
            copied++;
        }
        return copied;
    }
    async answer(scope, transactionIds, columnId, input) {
        const col = await this.owned(scope, columnId);
        const { value, dropDownId } = await this.checkedValue(col, input);
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), id: { in: transactionIds } },
            select: { id: true },
        });
        if (!rows.length)
            throw new common_1.NotFoundException('Transaction not found');
        const ids = rows.map((r) => r.id);
        if (value === null) {
            await this.prisma.customColumnAnswer.deleteMany({
                where: { customColumnId: col.id, transactionId: { in: ids } },
            });
            return ids.length;
        }
        await this.prisma.$transaction(ids.map((transactionId) => this.prisma.customColumnAnswer.upsert({
            where: {
                customColumnId_transactionId: {
                    customColumnId: col.id,
                    transactionId,
                },
            },
            create: { customColumnId: col.id, transactionId, value, dropDownId },
            update: { value, dropDownId },
        })));
        return ids.length;
    }
    async ensureQboColumn(scope, col) {
        const ref = col.kind === 'FIELD' ? col.ref : null;
        const labels = [
            ...new Map(col.options
                .map((o) => o.trim().replace(/\s+/g, ' ').slice(0, 120))
                .filter(Boolean)
                .map((o) => [o.toLowerCase(), o])).values(),
        ];
        const found = await this.prisma.customColumn.findFirst({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                qboKind: col.kind,
                qboRef: ref,
            },
            include: { options: { where: { deletedAt: null } } },
        });
        if (found) {
            if (found.type !== 'DROPDOWN')
                return found.id;
            const have = new Set(found.options.map((o) => o.label.toLowerCase()));
            const add = labels
                .filter((l) => !have.has(l.toLowerCase()))
                .slice(0, Math.max(0, custom_column_util_1.MAX_OPTIONS - found.options.length));
            if (add.length) {
                await this.prisma.customColumnDropDown.createMany({
                    data: add.map((label, i) => ({
                        customColumnId: found.id,
                        label,
                        sortOrder: found.options.length + i,
                    })),
                });
            }
            return found.id;
        }
        const count = await this.prisma.customColumn.count({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (count >= custom_column_util_1.MAX_CUSTOM_COLUMNS) {
            throw new common_1.BadRequestException(`A book has at most ${custom_column_util_1.MAX_CUSTOM_COLUMNS} columns of its own — “${col.name}” was not added`);
        }
        const base = col.name.trim().replace(/\s+/g, ' ').slice(0, 64) || 'QuickBooks field';
        let name = base;
        if (await this.nameTaken(scope, name)) {
            name = `${base.slice(0, 51)} (QuickBooks)`;
            for (let n = 2; await this.nameTaken(scope, name); n++) {
                name = `${base.slice(0, 47)} (QuickBooks ${n})`;
            }
        }
        const dropdown = col.kind === 'CLASS';
        const made = await this.prisma.customColumn.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name,
                type: dropdown ? 'DROPDOWN' : 'TEXT',
                sortOrder: count,
                qboKind: col.kind,
                qboRef: ref,
                options: dropdown
                    ? {
                        create: labels
                            .slice(0, custom_column_util_1.MAX_OPTIONS)
                            .map((label, i) => ({ label, sortOrder: i })),
                    }
                    : undefined,
            },
        });
        return made.id;
    }
    async setNameAnswer(scope, columnId, target, input) {
        const col = await this.owned(scope, columnId);
        const { value, dropDownId } = await this.checkedValue(col, input);
        let key;
        let fill;
        if (target.subNameId) {
            const sub = await this.prisma.subName.findFirst({
                where: { id: target.subNameId, bookId: scope.bookId },
                select: { id: true },
            });
            if (!sub)
                throw new common_1.NotFoundException('Sub-name not found');
            key = { nameId: null, subNameId: sub.id };
            fill = { subNameIds: [sub.id] };
        }
        else {
            const name = target.name?.replace(/\s+/g, ' ').trim();
            if (!name || (0, name_memory_util_1.nameKey)(name) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
                throw new common_1.BadRequestException('Pick a name');
            await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, name);
            const nameId = value === null
                ? (await this.prisma.ledgerName.findFirst({
                    where: { ...(0, scope_1.scopeWhere)(scope), name },
                    select: { id: true },
                }))?.id
                : await (0, sub_name_parents_1.ledgerNameId)(this.prisma, scope, name);
            if (nameId === undefined)
                return 0;
            key = { nameId, subNameId: null };
            fill = { names: [name] };
        }
        const found = await this.prisma.customColumnNameAnswer.findFirst({
            where: { customColumnId: col.id, ...key },
            select: { id: true },
        });
        if (value === null) {
            if (found)
                await this.prisma.customColumnNameAnswer.delete({
                    where: { id: found.id },
                });
            return 0;
        }
        if (found)
            await this.prisma.customColumnNameAnswer.update({
                where: { id: found.id },
                data: { value, dropDownId },
            });
        else
            await this.prisma.customColumnNameAnswer.create({
                data: { customColumnId: col.id, ...key, value, dropDownId },
            });
        return (0, custom_column_defaults_1.fillNameAnswers)(this.prisma, scope, fill);
    }
    async checkedValue(col, input) {
        const rules = {
            type: col.type,
            minChars: col.minChars,
            maxChars: col.maxChars,
        };
        let value = null;
        let dropDownId = null;
        if (rules.type === 'DROPDOWN') {
            const options = await this.prisma.customColumnDropDown.findMany({
                where: { customColumnId: col.id, deletedAt: null },
                select: { id: true, label: true },
            });
            const wanted = input.option?.trim().toLowerCase();
            const pick = input.dropDownId
                ? options.find((o) => o.id === input.dropDownId)
                : wanted
                    ? options.find((o) => o.label.toLowerCase() === wanted)
                    : null;
            if ((input.dropDownId || wanted) && !pick) {
                throw new common_1.BadRequestException(`Pick one of: ${options.map((o) => o.label).join(', ')}`);
            }
            if (pick) {
                dropDownId = pick.id;
                value = pick.label;
            }
        }
        else {
            const raw = (input.value ?? input.option ?? '').trim();
            const problem = (0, custom_column_util_1.answerProblem)(rules, raw);
            if (problem)
                throw new common_1.BadRequestException(`${col.name}: ${problem}`);
            value = raw || null;
        }
        return { value, dropDownId };
    }
    async exportCells(scope) {
        const v = await this.view(scope);
        const cells = new Map();
        for (const [tx, byCol] of Object.entries(v.answers)) {
            cells.set(Number(tx), v.columns.map((c) => {
                const a = byCol[c.id];
                if (!a)
                    return '';
                if (c.type === 'DROPDOWN') {
                    return c.options.find((o) => o.id === a.dropDownId)?.label ?? '';
                }
                return a.value ?? '';
            }));
        }
        return { columns: v.columns, cells };
    }
};
exports.CustomColumnsService = CustomColumnsService;
exports.CustomColumnsService = CustomColumnsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CustomColumnsService);
//# sourceMappingURL=custom-columns.service.js.map