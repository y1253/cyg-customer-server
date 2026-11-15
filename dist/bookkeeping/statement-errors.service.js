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
var StatementErrorsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatementErrorsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const change_feed_1 = require("../assistant/change-feed");
const prisma_service_1 = require("../prisma/prisma.service");
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const scope_1 = require("./scope");
const statement_problem_util_1 = require("./statement-problem.util");
const statement_errors_util_1 = require("./statement-errors.util");
const day = (d) => (d ? d.toISOString().slice(0, 10) : null);
let StatementErrorsService = StatementErrorsService_1 = class StatementErrorsService {
    prisma;
    logger = new common_1.Logger(StatementErrorsService_1.name);
    queued = new Map();
    running = new Map();
    timer = null;
    constructor(prisma) {
        this.prisma = prisma;
    }
    onApplicationBootstrap() {
        setTimeout(() => void this.backfill(), 90_000).unref();
    }
    async backfill() {
        try {
            const books = await this.prisma.bankStatement.groupBy({
                by: ['customerId', 'bookId', 'companyId'],
                where: {
                    deletedAt: null,
                    errorsCheckedAt: null,
                    status: { in: [client_1.StatementStatus.DONE, client_1.StatementStatus.NEEDS_REVIEW] },
                },
            });
            if (!books.length)
                return;
            let open = 0;
            for (const b of books)
                open += await this.refreshBook((0, scope_1.scopeOf)(b));
            this.logger.log(`statement errors: checked ${books.length} book(s), ${open} open error(s)`);
        }
        catch (err) {
            this.logger.error(`backfill failed: ${message(err)}`);
        }
    }
    refreshSoon(scope) {
        this.queued.set(scope.bookId, scope);
        if (this.timer)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const books = [...this.queued.values()];
            this.queued.clear();
            void (async () => {
                for (const b of books)
                    await this.refreshBook(b);
            })();
        }, 1500);
        this.timer.unref?.();
    }
    async refreshBook(scope) {
        const before = this.running.get(scope.bookId);
        const run = (before ?? Promise.resolve(0))
            .catch(() => 0)
            .then(() => this.refresh(scope));
        this.running.set(scope.bookId, run);
        try {
            return await run;
        }
        finally {
            if (this.running.get(scope.bookId) === run)
                this.running.delete(scope.bookId);
        }
    }
    async refresh(scope) {
        try {
            const found = await this.check(scope);
            const open = await this.prisma.statementError.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), resolvedAt: null },
            });
            const plan = (0, statement_errors_util_1.diffErrors)(open, found);
            const now = new Date();
            await this.prisma.$transaction([
                ...plan.create.map((e) => this.prisma.statementError.create({
                    data: {
                        ...(0, scope_1.scopeWhere)(scope),
                        statementId: e.statementId,
                        kind: e.kind,
                        title: e.title,
                        text: e.text,
                        details: (e.details ?? undefined),
                    },
                })),
                ...plan.update.map((e) => this.prisma.statementError.update({
                    where: { id: e.id },
                    data: {
                        title: e.title,
                        text: e.text,
                        details: (e.details ?? client_1.Prisma.DbNull),
                        checkedAt: now,
                    },
                })),
                ...(plan.resolve.length
                    ? [
                        this.prisma.statementError.updateMany({
                            where: { id: { in: plan.resolve } },
                            data: { resolvedAt: now, resolvedBy: 'SYSTEM' },
                        }),
                    ]
                    : []),
            ]);
            await this.prisma.$executeRaw `
        UPDATE BankStatement SET errorsCheckedAt = ${now}
        WHERE customerId = ${scope.customerId} AND bookId = ${scope.bookId} AND deletedAt IS NULL`;
            if (plan.create.length || plan.resolve.length) {
                change_feed_1.changeFeed.bump(scope.customerId);
                this.logger.log(`book ${scope.bookId}: ${plan.create.length} new, ${plan.resolve.length} resolved statement error(s)`);
            }
            return open.length + plan.create.length - plan.resolve.length;
        }
        catch (err) {
            this.logger.error(`book ${scope.bookId}: refresh failed: ${message(err)}`);
            return 0;
        }
    }
    async check(scope) {
        const [rows, opening] = await Promise.all([
            this.prisma.bankStatement.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    deletedAt: null,
                    status: { in: [client_1.StatementStatus.DONE, client_1.StatementStatus.NEEDS_REVIEW] },
                },
            }),
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, scope),
        ]);
        const starts = new Map([...(0, opening_balance_util_1.startsByAccount)((0, opening_balance_util_1.openingChain)(opening)).values()]
            .flat()
            .map((s) => [s.statementId, s]));
        const nets = new Map([...opening, ...(opening.bridges ?? [])].map((o) => [o.id, o.net]));
        const checked = rows.filter((r) => r.status === client_1.StatementStatus.DONE && r.source !== 'PLAID');
        const balances = checked.length
            ? await this.prisma.bankTransaction.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    statementId: { in: checked.map((r) => r.id) },
                    splitOfId: null,
                },
                select: {
                    statementId: true,
                    balanceAfter: true,
                    postingDate: true,
                },
                orderBy: [{ statementId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
            })
            : [];
        const rowsOf = new Map();
        for (const t of balances) {
            const list = rowsOf.get(t.statementId) ?? [];
            list.push({
                balanceAfter: t.balanceAfter === null ? null : Number(t.balanceAfter),
                postingDate: day(t.postingDate),
            });
            rowsOf.set(t.statementId, list);
        }
        const byId = new Map(rows.map((r) => [r.id, r]));
        const out = new Map();
        for (const r of rows) {
            const start = starts.get(r.id);
            const reason = start?.reason;
            const previous = reason?.kind === 'MISMATCH'
                ? byId.get(reason.previousStatementId)
                : undefined;
            const rereading = r.chainRereadAt !== null &&
                (r.processedAt === null || r.processedAt < r.chainRereadAt);
            out.set(r.id, (0, statement_problem_util_1.statementErrors)({
                ...r,
                openingBalance: r.openingBalance === null ? null : Number(r.openingBalance),
                closingBalance: r.closingBalance === null ? null : Number(r.closingBalance),
                net: nets.get(r.id),
                reason,
                rechecked: r.chainRereadAt !== null && previous?.chainRereadAt != null,
                rechecking: rereading,
                printedEnding: rowsOf.has(r.id)
                    ? (0, statement_problem_util_1.printedEnding)(rowsOf.get(r.id))
                    : undefined,
                startDerived: start?.derived,
            }));
        }
        return out;
    }
    async openFor(scope, statementIds) {
        const rows = await this.prisma.statementError.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                resolvedAt: null,
                ...(statementIds && { statementId: { in: statementIds } }),
            },
            orderBy: { id: 'asc' },
        });
        const out = new Map();
        for (const r of rows) {
            const list = out.get(r.statementId) ?? [];
            list.push(view(r));
            out.set(r.statementId, list);
        }
        for (const [id, list] of out)
            out.set(id, (0, statement_errors_util_1.orderErrors)(list));
        return out;
    }
    async list(scope, opts = {}) {
        const rows = await this.prisma.statementError.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                ...(opts.statementId && { statementId: opts.statementId }),
                ...(!opts.includeResolved && { resolvedAt: null }),
            },
            orderBy: [{ statementId: 'asc' }, { id: 'asc' }],
            take: 200,
        });
        return rows.map(view);
    }
    async add(scope, input) {
        const statement = await this.prisma.bankStatement.findFirst({
            where: { id: input.statementId, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { id: true },
        });
        if (!statement)
            throw new common_1.NotFoundException('Statement not found');
        const row = await this.prisma.statementError.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                statementId: statement.id,
                kind: 'OTHER',
                source: 'AI',
                title: input.title.trim().slice(0, 191),
                text: input.text.trim(),
                note: input.note?.trim() || null,
            },
        });
        change_feed_1.changeFeed.bump(scope.customerId);
        return view(row);
    }
    async resolve(scope, errorId, note) {
        const row = await this.prisma.statementError.findFirst({
            where: { id: errorId, ...(0, scope_1.scopeWhere)(scope) },
        });
        if (!row)
            throw new common_1.NotFoundException('Statement error not found');
        if (row.resolvedAt)
            return { resolved: true, error: view(row) };
        if (row.source !== 'AI') {
            await this.refreshBook(scope);
            const after = await this.prisma.statementError.findUniqueOrThrow({
                where: { id: errorId },
            });
            if (!after.resolvedAt) {
                return {
                    resolved: false,
                    reason: `The check still fails: ${after.text} Fix the cause (set the balances the statement prints, or re-read it) — the error then clears by itself.`,
                    error: view(after),
                };
            }
            if (note?.trim()) {
                await this.prisma.statementError.update({
                    where: { id: errorId },
                    data: { note: note.trim() },
                });
            }
            return { resolved: true, error: view(after) };
        }
        const done = await this.prisma.statementError.update({
            where: { id: errorId },
            data: {
                resolvedAt: new Date(),
                resolvedBy: 'AI',
                note: note?.trim() || row.note,
            },
        });
        change_feed_1.changeFeed.bump(scope.customerId);
        return { resolved: true, error: view(done) };
    }
};
exports.StatementErrorsService = StatementErrorsService;
exports.StatementErrorsService = StatementErrorsService = StatementErrorsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], StatementErrorsService);
function view(r) {
    return {
        id: r.id,
        statementId: r.statementId,
        kind: r.kind,
        title: r.title,
        text: r.text,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedBy: r.resolvedBy,
        note: r.note,
    };
}
const message = (err) => err instanceof Error ? err.message : String(err);
//# sourceMappingURL=statement-errors.service.js.map