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
exports.CustomerAccountsService = exports.ACCOUNT_TYPES = void 0;
const common_1 = require("@nestjs/common");
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
let CustomerAccountsService = class CustomerAccountsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
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
exports.CustomerAccountsService = CustomerAccountsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CustomerAccountsService);
//# sourceMappingURL=customer-accounts.service.js.map