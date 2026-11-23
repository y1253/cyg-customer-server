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
exports.LedgerQueryService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const bookkeeping_service_1 = require("./bookkeeping.service");
const custom_columns_service_1 = require("./custom-columns.service");
const ledger_query_util_1 = require("./ledger-query.util");
const scope_1 = require("./scope");
let LedgerQueryService = class LedgerQueryService {
    prisma;
    bookkeeping;
    customColumns;
    constructor(prisma, bookkeeping, customColumns) {
        this.prisma = prisma;
        this.bookkeeping = bookkeeping;
        this.customColumns = customColumns;
    }
    async page(scope, query, offset, limit) {
        const { families } = await this.run(scope, query);
        return {
            ...(0, ledger_query_util_1.pageOfFamilies)(families, offset, limit),
            families: families.length,
        };
    }
    async summary(scope, query) {
        return (await this.run(scope, query)).summary;
    }
    async run(scope, query) {
        const customKeys = [
            ...Object.keys(query.filters ?? {}).filter((k) => (0, ledger_query_util_1.isActive)(query.filters[k])),
            ...(query.sort ? [query.sort.key] : []),
        ].filter((k) => /^c\d+$/.test(k));
        const [all, statements, custom] = await Promise.all([
            this.bookkeeping.transactions(scope),
            this.prisma.bankStatement.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    deletedAt: null,
                    status: client_1.StatementStatus.DONE,
                },
                select: { id: true, periodEnd: true },
            }),
            customKeys.length ? this.customColumns.view(scope) : null,
        ]);
        return (0, ledger_query_util_1.queryLedger)(all, query, {
            periodEnd: new Map(statements.map((s) => [
                s.id,
                s.periodEnd ? s.periodEnd.toISOString().slice(0, 10) : null,
            ])),
            columns: custom?.columns,
            answerText: custom
                ? (columnId, transactionId) => {
                    const a = custom.answers[transactionId]?.[columnId];
                    if (!a)
                        return null;
                    const col = custom.columns.find((c) => c.id === columnId);
                    if (col?.type === 'DROPDOWN')
                        return (col.options.find((o) => o.id === a.dropDownId)?.label ?? null);
                    return a.value;
                }
                : undefined,
        });
    }
};
exports.LedgerQueryService = LedgerQueryService;
exports.LedgerQueryService = LedgerQueryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        bookkeeping_service_1.BookkeepingService,
        custom_columns_service_1.CustomColumnsService])
], LedgerQueryService);
//# sourceMappingURL=ledger-query.service.js.map