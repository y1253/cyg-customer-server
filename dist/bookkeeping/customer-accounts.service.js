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
    async mergeAccounts(scope, rawFrom, rawInto, rawName) {
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
        const newName = rawName?.trim() || into;
        let rename = [];
        if (newName !== into) {
            const refusal = (0, account_merge_util_1.renameRefusal)(intoSide, newName, await this.nameTaken(scope, newName, [from, into]));
            if (refusal)
                throw new common_1.BadRequestException(refusal);
            rename = await this.renameWrites(scope, into, newName);
        }
        const where = (0, scope_1.scopeWhere)(scope);
        await this.prisma.$transaction([
            ...this.repointWrites(scope, from, into),
            this.prisma.customerAccountType.deleteMany({
                where: { ...where, account: from },
            }),
            this.prisma.customerAccountCurrency.deleteMany({
                where: { ...where, account: from },
            }),
            this.prisma.customerAccount.deleteMany({
                where: { ...where, name: from },
            }),
            ...rename,
        ]);
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: merged account "${from}" into "${into}"` +
            `${newName !== into ? ` as "${newName}"` : ''} (${used} rows)`);
    }
    async renameAccount(scope, rawFrom, rawTo) {
        const from = rawFrom.trim();
        const to = rawTo.trim();
        if (!from)
            throw new common_1.BadRequestException('Which account?');
        const [side, replaced] = await Promise.all([
            this.mergeSide(scope, from),
            this.prisma.customerAccount.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), name: from },
                select: { replaces: true },
            }),
        ]);
        const back = replaced?.replaces ? [replaced.replaces] : [];
        const taken = await this.nameTaken(scope, to, [from, ...back]);
        const refusal = (0, account_merge_util_1.renameRefusal)(side, to, taken);
        if (refusal) {
            if (taken)
                throw new common_1.ConflictException(refusal);
            throw new common_1.BadRequestException(refusal);
        }
        const writes = await this.renameWrites(scope, from, to);
        if (!writes.length)
            throw new common_1.BadRequestException(`"${from}" is not one of your accounts.`);
        await this.prisma.$transaction(writes);
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: renamed account "${from}" to "${to}"`);
    }
    async renameWrites(scope, from, to) {
        const where = (0, scope_1.scopeWhere)(scope);
        const [used, folder, own] = await Promise.all([
            this.prisma.bankTransaction.count({
                where: {
                    ...where,
                    OR: [
                        { offsetAccount: from },
                        { debitAccount: from },
                        { creditAccount: from },
                    ],
                },
            }),
            this.prisma.bankStatement.count({
                where: { ...where, accountName: from, deletedAt: null },
            }),
            this.prisma.customerAccount.findFirst({
                where: { ...where, name: from },
                select: { id: true, replaces: true },
            }),
        ]);
        const chart = chart_of_accounts_1.CHART_OF_ACCOUNTS.find((a) => a.name.toLowerCase() === from.toLowerCase());
        const plaid = await this.prisma.plaidAccount.count({
            where: { item: where, accountName: from },
        });
        if (!used && !folder && !own && !plaid && !chart)
            return [];
        const writes = [
            ...this.repointWrites(scope, from, to),
            this.prisma.customerAccountType.updateMany({
                where: { ...where, account: from },
                data: { account: to },
            }),
            this.prisma.customerAccountCurrency.updateMany({
                where: { ...where, account: from },
                data: { account: to },
            }),
        ];
        if (own && own.replaces?.toLowerCase() === to.toLowerCase()) {
            writes.push(this.prisma.customerAccount.delete({ where: { id: own.id } }));
        }
        else if (own) {
            writes.push(this.prisma.customerAccount.update({
                where: { id: own.id },
                data: { name: to },
            }));
        }
        else if (chart && !folder && !plaid) {
            writes.push(this.prisma.customerAccount.create({
                data: { ...where, name: to, type: chart.type, replaces: chart.name },
            }));
        }
        return writes;
    }
    repointWrites(scope, from, to) {
        const where = (0, scope_1.scopeWhere)(scope);
        return [
            this.prisma.bankTransaction.updateMany({
                where: { ...where, offsetAccount: from },
                data: { offsetAccount: to },
            }),
            this.prisma.bankTransaction.updateMany({
                where: { ...where, debitAccount: from },
                data: { debitAccount: to },
            }),
            this.prisma.bankTransaction.updateMany({
                where: { ...where, creditAccount: from },
                data: { creditAccount: to },
            }),
            this.prisma.bankStatement.updateMany({
                where: { ...where, accountName: from },
                data: { accountName: to },
            }),
            this.prisma.bankStatement.updateMany({
                where: { ...where, accountNameByCustomer: from },
                data: { accountNameByCustomer: to },
            }),
            this.prisma.plaidAccount.updateMany({
                where: { item: where, accountName: from },
                data: { accountName: to },
            }),
            this.prisma.customerNameRule.updateMany({
                where: { ...where, category: from },
                data: { category: to },
            }),
            this.prisma.customerItemRule.updateMany({
                where: { ...where, category: from },
                data: { category: to },
            }),
        ];
    }
    async nameTaken(scope, name, except) {
        const wanted = name.trim().toLowerCase();
        if (except.some((e) => e.trim().toLowerCase() === wanted))
            return false;
        if (chart_of_accounts_1.ACCOUNT_NAMES.some((n) => n.toLowerCase() === wanted))
            return true;
        const where = (0, scope_1.scopeWhere)(scope);
        const [own, agency, statement, plaid, row] = await Promise.all([
            this.prisma.customerAccount.findFirst({
                where: { ...where, name },
                select: { id: true },
            }),
            this.prisma.taxAgency.findFirst({
                where: { ...where, name, deletedAt: null },
                select: { id: true },
            }),
            this.prisma.bankStatement.findFirst({
                where: { ...where, accountName: name, deletedAt: null },
                select: { id: true },
            }),
            this.prisma.plaidAccount.findFirst({
                where: { item: where, accountName: name },
                select: { id: true },
            }),
            this.prisma.bankTransaction.findFirst({
                where: {
                    ...where,
                    OR: [
                        { offsetAccount: name },
                        { debitAccount: name },
                        { creditAccount: name },
                    ],
                },
                select: { id: true },
            }),
        ]);
        return !!(own || agency || statement || plaid || row);
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
        const replaced = new Set(own.map((a) => a.replaces?.toLowerCase()).filter(Boolean));
        return [
            ...chart_of_accounts_1.CHART_OF_ACCOUNTS.filter((a) => !replaced.has(a.name.toLowerCase())).map((a) => ({ ...a, custom: false })),
            ...own.map((a) => ({ name: a.name, type: a.type, custom: true })),
        ];
    }
    async renamed(scope) {
        return new Map((await this.own(scope))
            .filter((a) => a.replaces)
            .map((a) => [a.replaces.toLowerCase(), a.name]));
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
        const accounts = await this.own(scope);
        const renamed = accounts.find((a) => a.replaces?.toLowerCase() === wanted);
        if (renamed)
            return renamed.name;
        const chart = chart_of_accounts_1.ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
        if (chart)
            return chart;
        const own = accounts.find((a) => a.name.toLowerCase() === wanted);
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
            select: { name: true, type: true, replaces: true },
            orderBy: { name: 'asc' },
        });
        return rows.map((r) => ({
            name: r.name,
            replaces: r.replaces,
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