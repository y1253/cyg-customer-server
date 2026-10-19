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
exports.StaffRulesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_service_1 = require("./name-memory.service");
const name_memory_util_1 = require("./name-memory.util");
const scope_1 = require("./scope");
let StaffRulesService = class StaffRulesService {
    prisma;
    accounts;
    nameMemory;
    constructor(prisma, accounts, nameMemory) {
        this.prisma = prisma;
        this.accounts = accounts;
        this.nameMemory = nameMemory;
    }
    async view(scope) {
        const [rules, items, rows, categories] = await Promise.all([
            this.prisma.customerNameRule.findMany({
                where: (0, scope_1.scopeWhere)(scope),
                orderBy: { updatedAt: 'desc' },
            }),
            this.prisma.customerItemRule.findMany({
                where: (0, scope_1.scopeWhere)(scope),
                orderBy: { updatedAt: 'desc' },
            }),
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), splitOfId: null },
                select: { description: true, name: true },
            }),
            this.accounts.list(scope),
        ]);
        const byDescription = new Map();
        const byName = new Map();
        for (const r of rows) {
            const key = (0, name_memory_util_1.descriptionKey)(r.description);
            if (key) {
                const hit = byDescription.get(key);
                if (hit)
                    hit.rows++;
                else
                    byDescription.set(key, { rows: 1, example: r.description });
            }
            const name = (0, name_memory_util_1.cleanName)(r.name);
            if (name)
                byName.set((0, name_memory_util_1.nameKey)(name), (byName.get((0, name_memory_util_1.nameKey)(name)) ?? 0) + 1);
        }
        const views = await Promise.all(rules.map(async (r) => {
            const name = (0, name_memory_util_1.cleanName)(r.name);
            const description = r.matchType === 'DESCRIPTION'
                ? byDescription.get(r.matchKey)
                : undefined;
            const names = new Set([r.matchKey, ...(name ? [(0, name_memory_util_1.nameKey)(name)] : [])]);
            const rowCount = r.matchType === 'DESCRIPTION'
                ? (description?.rows ?? 0)
                : [...names].reduce((n, k) => n + (byName.get(k) ?? 0), 0);
            return {
                id: r.id,
                matchType: r.matchType === 'NAME' ? 'NAME' : 'DESCRIPTION',
                matchKey: r.matchKey,
                example: description?.example ?? null,
                name,
                category: r.category,
                effectiveCategory: r.category ??
                    (name ? await this.nameMemory.categoryOfName(scope, name) : null),
                rows: rowCount,
                updatedAt: r.updatedAt.toISOString(),
            };
        }));
        return {
            descriptions: views.filter((v) => v.matchType === 'DESCRIPTION'),
            names: views.filter((v) => v.matchType === 'NAME'),
            items: items.map((i) => ({
                id: i.id,
                itemKey: i.itemKey,
                category: i.category,
                updatedAt: i.updatedAt.toISOString(),
            })),
            categories,
        };
    }
};
exports.StaffRulesService = StaffRulesService;
exports.StaffRulesService = StaffRulesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService,
        name_memory_service_1.NameMemoryService])
], StaffRulesService);
//# sourceMappingURL=staff-rules.service.js.map