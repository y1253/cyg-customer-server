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
    async list(customerId) {
        const own = await this.own(customerId);
        return [
            ...chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => ({ ...a, custom: false })),
            ...own.map((a) => ({ ...a, custom: true })),
        ];
    }
    async types(customerId) {
        return new Map((await this.own(customerId)).map((a) => [a.name, a.type]));
    }
    async overrides(customerId) {
        const rows = await this.prisma.customerAccountType.findMany({
            where: { customerId },
            select: { account: true, type: true },
        });
        return new Map(rows
            .filter((r) => exports.ACCOUNT_TYPES.includes(r.type))
            .map((r) => [r.account, r.type]));
    }
    async setType(customerId, account, type) {
        const name = account.trim();
        if (!name)
            throw new common_1.BadRequestException('Which account?');
        if (!exports.ACCOUNT_TYPES.includes(type)) {
            throw new common_1.BadRequestException('Choose a section');
        }
        await this.prisma.customerAccountType.upsert({
            where: { customerId_account: { customerId, account: name } },
            create: { customerId, account: name, type },
            update: { type },
        });
    }
    async resetType(customerId, account) {
        await this.prisma.customerAccountType.deleteMany({
            where: { customerId, account: account.trim() },
        });
    }
    async setCurrency(customerId, account, currency) {
        const name = account.trim();
        const code = currency.trim().toUpperCase();
        if (!(0, fx_util_1.isFxCurrency)(code)) {
            throw new common_1.BadRequestException(`${code} is not a currency we have daily rates for`);
        }
        const statement = await this.prisma.bankStatement.findFirst({
            where: { customerId, accountName: name, deletedAt: null },
            select: { id: true },
        });
        if (!statement) {
            throw new common_1.BadRequestException(`"${name}" is not one of your accounts`);
        }
        await this.prisma.customerAccountCurrency.upsert({
            where: { customerId_account: { customerId, account: name } },
            create: { customerId, account: name, currency: code },
            update: { currency: code },
        });
    }
    async resetCurrency(customerId, account) {
        await this.prisma.customerAccountCurrency.deleteMany({
            where: { customerId, account: account.trim() },
        });
    }
    async names(customerId) {
        return new Set((await this.own(customerId)).map((a) => a.name));
    }
    async validCategory(customerId, name) {
        const wanted = name.trim().toLowerCase();
        const chart = chart_of_accounts_1.ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
        if (chart)
            return chart;
        const own = (await this.own(customerId)).find((a) => a.name.toLowerCase() === wanted);
        if (own)
            return own.name;
        throw new common_1.BadRequestException(`"${name}" is not one of your categories. Create it first.`);
    }
    async create(customerId, input) {
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
            where: { customerId, name, deletedAt: null },
            select: { id: true },
        });
        if (agency) {
            throw new common_1.BadRequestException(`"${name}" is one of your tax agencies`);
        }
        const existing = await this.prisma.customerAccount.findUnique({
            where: { customerId_name: { customerId, name } },
        });
        if (existing) {
            if (existing.type !== input.type) {
                throw new common_1.BadRequestException(`You already have a category called "${existing.name}"`);
            }
            return { name: existing.name, type: input.type, custom: true };
        }
        const row = await this.prisma.customerAccount.create({
            data: { customerId, name, type: input.type },
        });
        return { name: row.name, type: input.type, custom: true };
    }
    async own(customerId) {
        const rows = await this.prisma.customerAccount.findMany({
            where: { customerId },
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