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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var StaffTransactionsController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffTransactionsController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const quickbooks_sync_service_1 = require("../quickbooks-sync/quickbooks-sync.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const custom_columns_service_1 = require("./custom-columns.service");
const agency_dto_1 = require("./dto/agency.dto");
const custom_column_dto_1 = require("./dto/custom-column.dto");
const ledger_query_dto_1 = require("./dto/ledger-query.dto");
const ledger_query_service_1 = require("./ledger-query.service");
const name_memory_service_1 = require("./name-memory.service");
const scope_1 = require("./scope");
const staff_book_guard_1 = require("./staff-book.guard");
let StaffTransactionsController = StaffTransactionsController_1 = class StaffTransactionsController {
    ledgerQuery;
    accounts;
    nameMemory;
    qbo;
    prisma;
    columns;
    logger = new common_1.Logger(StaffTransactionsController_1.name);
    constructor(ledgerQuery, accounts, nameMemory, qbo, prisma, columns) {
        this.ledgerQuery = ledgerQuery;
        this.accounts = accounts;
        this.nameMemory = nameMemory;
        this.qbo = qbo;
        this.prisma = prisma;
        this.columns = columns;
    }
    async cellsOf(ids) {
        const out = new Map();
        if (!ids.length)
            return out;
        const answers = await this.prisma.customColumnAnswer.findMany({
            where: {
                transactionId: { in: ids },
                column: { deletedAt: null },
            },
            select: {
                transactionId: true,
                customColumnId: true,
                value: true,
                dropDownId: true,
                dropDown: { select: { label: true, deletedAt: true } },
            },
        });
        for (const a of answers) {
            const cells = out.get(a.transactionId) ?? {};
            const live = a.dropDown && !a.dropDown.deletedAt;
            cells[a.customColumnId] = {
                value: live ? a.dropDown.label : a.value,
                dropDownId: live ? a.dropDownId : null,
            };
            out.set(a.transactionId, cells);
        }
        return out;
    }
    async page(staff, dto) {
        const { query, offset, limit } = (0, ledger_query_dto_1.ledgerQueryOf)(dto);
        const page = await this.ledgerQuery.page(staff.scope, query, offset, limit);
        const rows = page.rows.filter((r) => r.kind === undefined || r.kind === 'split');
        const top = rows.filter((r) => r.kind === undefined).map((r) => r.id);
        const qbo = top.length
            ? await this.prisma.bankTransaction.findMany({
                where: { id: { in: top } },
                select: { id: true, qboId: true, qboSyncedAt: true, qboError: true },
            })
            : [];
        const byId = new Map(qbo.map((q) => [q.id, q]));
        const cells = await this.cellsOf(rows.map((r) => r.id));
        return {
            nextOffset: page.nextOffset,
            rows: rows.map((r) => {
                const q = byId.get(r.id);
                const split = r.kind === 'split';
                return {
                    key: r.key,
                    id: r.id,
                    kind: split ? 'split' : 'transaction',
                    splitOfId: r.splitOfId ?? null,
                    date: r.postingDate ?? r.pendingDate,
                    name: r.name,
                    subName: r.subName?.name ?? null,
                    category: r.offsetAccount,
                    amount: r.amount,
                    fullAmount: r.fullAmount ?? null,
                    account: r.statementLabel,
                    qbo: split || !q
                        ? null
                        : {
                            id: q.qboId,
                            syncedAt: q.qboSyncedAt?.toISOString() ?? null,
                            error: q.qboError,
                        },
                    custom: cells.get(r.id) ?? {},
                };
            }),
        };
    }
    summary(staff, dto) {
        return this.ledgerQuery.summary(staff.scope, (0, ledger_query_dto_1.ledgerQueryOf)(dto).query);
    }
    categories(staff) {
        return this.accounts.list(staff.scope);
    }
    async customColumns(staff) {
        return (await this.columns.view(staff.scope)).columns;
    }
    async answer(_companyId, id, columnId, staff, dto) {
        await this.columns.answer(staff.scope, [id], columnId, dto);
        this.logger.log(`staff user #${staff.staffUserId} set column #${columnId} on transaction #${id} for ${(0, scope_1.bookLabel)(staff.scope)}`);
        this.qbo.syncSoon(staff.scope.bookId);
        return (await this.cellsOf([id])).get(id) ?? {};
    }
    async edit(_companyId, id, staff, dto) {
        const { name, category } = await this.accounts.editValues(staff.scope, dto);
        await this.nameMemory.editTransaction(staff.scope, id, {
            name,
            category,
            scope: dto.scope,
            replace: true,
        });
        this.logger.log(`staff user #${staff.staffUserId} edited transaction #${id} (${[
            name && `name "${name}"`,
            category && `category "${category}"`,
            dto.scope,
        ]
            .filter(Boolean)
            .join(', ')}) for ${(0, scope_1.bookLabel)(staff.scope)}`);
        this.qbo.syncSoon(staff.scope.bookId);
    }
};
exports.StaffTransactionsController = StaffTransactionsController;
__decorate([
    (0, common_1.Get)('page'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ledger_query_dto_1.LedgerQueryDto]),
    __metadata("design:returntype", Promise)
], StaffTransactionsController.prototype, "page", null);
__decorate([
    (0, common_1.Get)('summary'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ledger_query_dto_1.LedgerQueryDto]),
    __metadata("design:returntype", Promise)
], StaffTransactionsController.prototype, "summary", null);
__decorate([
    (0, common_1.Get)('categories'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StaffTransactionsController.prototype, "categories", null);
__decorate([
    (0, common_1.Get)('custom-columns'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StaffTransactionsController.prototype, "customColumns", null);
__decorate([
    (0, common_1.Put)(':id/custom/:columnId'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)('columnId', common_1.ParseIntPipe)),
    __param(3, (0, staff_book_guard_1.Staff)()),
    __param(4, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number, Number, Object, custom_column_dto_1.CustomAnswerDto]),
    __metadata("design:returntype", Promise)
], StaffTransactionsController.prototype, "answer", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, staff_book_guard_1.Staff)()),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number, Object, agency_dto_1.EditTransactionDto]),
    __metadata("design:returntype", Promise)
], StaffTransactionsController.prototype, "edit", null);
exports.StaffTransactionsController = StaffTransactionsController = StaffTransactionsController_1 = __decorate([
    (0, common_1.Controller)('staff/books/:companyId/transactions'),
    (0, common_1.UseGuards)(staff_book_guard_1.StaffBookGuard),
    __metadata("design:paramtypes", [ledger_query_service_1.LedgerQueryService,
        customer_accounts_service_1.CustomerAccountsService,
        name_memory_service_1.NameMemoryService,
        quickbooks_sync_service_1.QuickBooksSyncService,
        prisma_service_1.PrismaService,
        custom_columns_service_1.CustomColumnsService])
], StaffTransactionsController);
//# sourceMappingURL=staff-transactions.controller.js.map