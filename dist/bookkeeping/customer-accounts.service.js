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
var CustomerAccountsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerAccountsService = exports.ACCOUNT_TYPES = void 0;
const common_1 = require("@nestjs/common");
const account_merge_util_1 = require("./account-merge.util");
const prisma_service_1 = require("../prisma/prisma.service");
const fx_util_1 = require("./fx.util");
const reports_util_1 = require("./reports.util");
const scope_1 = require("./scope");
const chart_of_accounts_1 = require("./chart-of-accounts");
exports.ACCOUNT_TYPES = [
    'INCOME',
    'EXPENSE',
    'ASSET',
    'LIABILITY',
    'EQUITY',
];
let CustomerAccountsService = CustomerAccountsService_1 = class CustomerAccountsService {
    prisma;
    logger = new common_1.Logger(CustomerAccountsService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async mergeAccounts(scope, rawFrom, rawInto) {
        const from = rawFrom.trim();
        const into = rawInto.trim();
        if (!from || !into)
            throw new common_1.BadRequestException('Pick two accounts.');
        const [fromSide, intoSide] = await Promise.all([
            this.mergeSide(scope, from),
            this.mergeSide(scope, into),
        ]);
        const refusal = (0, account_merge_util_1.mergeRefusal)(fromSide, intoSide);
        if (refusal)
            throw new common_1.BadRequestException(refusal);
        const used = await this.prisma.bankTransaction.count({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                OR: [
                    { offsetAccount: from },
                    { debitAccount: from },
                    { creditAccount: from },
                ],
            },
        });
        const own = await this.prisma.customerAccount.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name: from },
            select: { id: true },
        });
        if (!used && !fromSide.folder && !own)
            throw new common_1.BadRequestException(`"${from}" has nothing to merge.`);
        const where = (0, scope_1.scopeWhere)(scope);
        await this.prisma.$transaction([
            this.prisma.bankTransaction.updateMany({
                where: { ...where, offsetAccount: from },
                data: { offsetAccount: into },
            }),
            this.prisma.bankTransaction.updateMany({
                where: { ...where, debitAccount: from },
                data: { debitAccount: into },
            }),
            this.prisma.bankTransaction.updateMany({
                where: { ...where, creditAccount: from },
                data: { creditAccount: into },
            }),
            this.prisma.bankStatement.updateMany({
                where: { ...where, accountName: from },
                data: { accountName: into },
            }),
            this.prisma.bankStatement.updateMany({
                where: { ...where, accountNameByCustomer: from },
                data: { accountNameByCustomer: into },
            }),
            this.prisma.plaidAccount.updateMany({
                where: { item: where, accountName: from },
                data: { accountName: into },
            }),
            this.prisma.customerNameRule.updateMany({
                where: { ...where, category: from },
                data: { category: into },
            }),
            this.prisma.customerItemRule.updateMany({
                where: { ...where, category: from },
                data: { category: into },
            }),
            this.prisma.customerAccountType.deleteMany({
                where: { ...where, account: from },
            }),
            this.prisma.customerAccountCurrency.deleteMany({
                where: { ...where, account: from },
            }),
            this.prisma.customerAccount.deleteMany({
                where: { ...where, name: from },
            }),
        ]);
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: merged account "${from}" into "${into}" (${used} rows)`);
    }
    async mergeSide(scope, name) {
        const [agency, statement, plaid, currency] = await Promise.all([
            this.prisma.taxAgency.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), name, deletedAt: null },
                select: { id: true },
            }),
            this.prisma.bankStatement.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), accountName: name, deletedAt: null },
                orderBy: { id: 'desc' },
                select: { accountKind: true, currency: true },
            }),
            this.prisma.plaidAccount.findFirst({
                where: {
                    item: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                    accountName: name,
                },
                select: { kind: true, currency: true },
            }),
            this.prisma.customerAccountCurrency.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), account: name },
                select: { currency: true },
            }),
        ]);
        const kind = statement?.accountKind ?? plaid?.kind ?? null;
        return {
            name,
            agency: !!agency,
            folder: statement || plaid
                ? {
                    kind: kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
                    currency: currency?.currency ??
                        statement?.currency ??
                        plaid?.currency ??
                        null,
                }
                : null,
        };
    }
    async list(scope) {
        const own = await this.own(scope);
        return [
            ...chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => ({ ...a, custom: false })),
            ...own.map((a) => ({ ...a, custom: true })),
        ];
    }
    async types(scope) {
        return new Map((await this.own(scope)).map((a) => [a.name, a.type]));
    }
    async overrides(scope) {
        const rows = await this.prisma.customerAccountType.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { account: true, type: true },
        });
        return new Map(rows
            .filter((r) => exports.ACCOUNT_TYPES.includes(r.type))
            .map((r) => [r.account, r.type]));
    }
    async setType(scope, account, type) {
        const name = account.trim();
        if (!name)
            throw new common_1.BadRequestException('Which account?');
        if (!exports.ACCOUNT_TYPES.includes(type)) {
            throw new common_1.BadRequestException('Choose a section');
        }
        const found = await this.prisma.customerAccountType.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), account: name },
            select: { id: true },
        });
        if (found) {
            await this.prisma.customerAccountType.update({
                where: { id: found.id },
                data: { type },
            });
        }
        else {
            await this.prisma.customerAccountType.create({
                data: { ...(0, scope_1.scopeWhere)(scope), account: name, type },
            });
        }
    }
    async resetType(scope, account) {
        await this.prisma.customerAccountType.deleteMany({
            where: { ...(0, scope_1.scopeWhere)(scope), account: account.trim() },
        });
    }
    async setCurrency(scope, account, currency) {
        const name = account.trim();
        const code = currency.trim().toUpperCase();
        if (!(0, fx_util_1.isFxCurrency)(code)) {
            throw new common_1.BadRequestException(`${code} is not a currency we have daily rates for`);
        }
        const statement = await this.prisma.bankStatement.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), accountName: name, deletedAt: null },
            select: { id: true },
        });
        if (!statement) {
            throw new common_1.BadRequestException(`"${name}" is not one of your accounts`);
        }
        const found = await this.prisma.customerAccountCurrency.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), account: name },
            select: { id: true },
        });
        if (found) {
            await this.prisma.customerAccountCurrency.update({
                where: { id: found.id },
                data: { currency: code },
            });
        }
        else {
            await this.prisma.customerAccountCurrency.create({
                data: { ...(0, scope_1.scopeWhere)(scope), account: name, currency: code },
            });
        }
    }
    async resetCurrency(scope, account) {
        await this.prisma.customerAccountCurrency.deleteMany({
            where: { ...(0, scope_1.scopeWhere)(scope), account: account.trim() },
        });
    }
    async names(scope) {
        return new Set((await this.own(scope)).map((a) => a.name));
    }
    async validCategory(scope, name) {
        const wanted = name.trim().toLowerCase();
        const chart = chart_of_accounts_1.ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
        if (chart)
            return chart;
        const own = (await this.own(scope)).find((a) => a.name.toLowerCase() === wanted);
        if (own)
            return own.name;
        throw new common_1.BadRequestException(`"${name}" is not one of your categories. Create it first.`);
    }
    async editValues(scope, dto) {
        const name = dto.name?.trim() || null;
        const raw = dto.category?.trim() || null;
        if (!name && !raw) {
            throw new common_1.BadRequestException('Enter a name or choose a category');
        }
        if (name && name.toLowerCase() === reports_util_1.UNCLARIFIED_NAME.toLowerCase()) {
            throw new common_1.BadRequestException(`"${reports_util_1.UNCLARIFIED_NAME}" is kept for rows with no name — enter the real name`);
        }
        const category = raw ? await this.validCategory(scope, raw) : null;
        return { name, category };
    }
    async create(scope, input) {
        const name = input.name.trim();
        if (!name)
            throw new common_1.BadRequestException('Enter a name for the category');
        if (!exports.ACCOUNT_TYPES.includes(input.type)) {
            throw new common_1.BadRequestException('Choose what kind of account it is');
        }
        if (chart_of_accounts_1.ACCOUNT_NAMES.some((n) => n.toLowerCase() === name.toLowerCase())) {
            throw new common_1.BadRequestException(`"${name}" is already in the list — pick it there`);
        }
        const agency = await this.prisma.taxAgency.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name, deletedAt: null },
            select: { id: true },
        });
        if (agency) {
            throw new common_1.BadRequestException(`"${name}" is one of your tax agencies`);
        }
        const existing = await this.prisma.customerAccount.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name },
        });
        if (existing) {
            if (existing.type !== input.type) {
                throw new common_1.BadRequestException(`You already have a category called "${existing.name}"`);
            }
            return { name: existing.name, type: input.type, custom: true };
        }
        const row = await this.prisma.customerAccount.create({
            data: { ...(0, scope_1.scopeWhere)(scope), name, type: input.type },
        });
        return { name: row.name, type: input.type, custom: true };
    }
    async own(scope) {
        const rows = await this.prisma.customerAccount.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true, type: true },
            orderBy: { name: 'asc' },
        });
        return rows.map((r) => ({
            name: r.name,
            type: exports.ACCOUNT_TYPES.includes(r.type)
                ? r.type
                : 'EXPENSE',
        }));
    }
};
exports.CustomerAccountsService = CustomerAccountsService;
exports.CustomerAccountsService = CustomerAccountsService = CustomerAccountsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CustomerAccountsService);
//# sourceMappingURL=customer-accounts.service.js.map