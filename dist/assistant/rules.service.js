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
var RulesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RulesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const scope_1 = require("../bookkeeping/scope");
const instructions_service_1 = require("./instructions.service");
const rules_util_1 = require("./rules.util");
let RulesService = RulesService_1 = class RulesService {
    prisma;
    instructions;
    logger = new common_1.Logger(RulesService_1.name);
    constructor(prisma, instructions) {
        this.prisma = prisma;
        this.instructions = instructions;
    }
    async promptBlock(scope, topic, target) {
        const extra = target && this.instructions ? await this.instructions.block(target) : '';
        return extra + (await this.rulesOnly(scope, topic));
    }
    async rulesOnly(scope, topic) {
        try {
            const [global, own] = await Promise.all([
                this.prisma.aiRule.findMany({
                    where: { status: 'ACTIVE', deletedAt: null },
                    orderBy: { updatedAt: 'desc' },
                    take: 200,
                    select: { text: true, topic: true },
                }),
                this.prisma.customerAiRule.findMany({
                    where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                    orderBy: { createdAt: 'desc' },
                    take: 200,
                    select: { text: true, topic: true },
                }),
            ]);
            return (0, rules_util_1.rulesBlock)([
                ...own.map((r) => ({ ...r, global: false })),
                ...global.map((r) => ({ ...r, global: true })),
            ], topic);
        }
        catch (err) {
            this.logger.warn(`rules block failed: ${err instanceof Error ? err.message : err}`);
            return '';
        }
    }
    async saveCustomerRule(scope, text, topic, sourceMessageId = null) {
        const clean = (0, rules_util_1.cleanRuleText)(text);
        if (!clean)
            return false;
        const existing = await this.prisma.customerAiRule.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { text: true },
        });
        if (existing.some((r) => (0, rules_util_1.ruleKey)(r.text) === (0, rules_util_1.ruleKey)(clean)))
            return false;
        await this.prisma.customerAiRule.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                text: clean,
                topic: (0, rules_util_1.isRuleTopic)(topic) ? topic : 'GENERAL',
                sourceMessageId,
            },
        });
        return true;
    }
    async proposeGlobalRule(text, topic, sourceCustomerId, sourceMessageId = null) {
        const clean = (0, rules_util_1.cleanRuleText)(text);
        if (!clean)
            return false;
        const existing = await this.prisma.aiRule.findMany({
            where: { deletedAt: null, status: { in: ['PENDING', 'ACTIVE'] } },
            select: { text: true },
        });
        if (existing.some((r) => (0, rules_util_1.ruleKey)(r.text) === (0, rules_util_1.ruleKey)(clean)))
            return false;
        await this.prisma.aiRule.create({
            data: {
                text: clean,
                topic: (0, rules_util_1.isRuleTopic)(topic) ? topic : 'GENERAL',
                status: 'PENDING',
                sourceCustomerId,
                sourceMessageId,
            },
        });
        return true;
    }
    async listCustomerRules(scope) {
        const rows = await this.prisma.customerAiRule.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r) => ({
            id: r.id,
            text: r.text,
            topic: r.topic,
            createdAt: r.createdAt.toISOString(),
        }));
    }
    async deleteCustomerRule(scope, id) {
        const res = await this.prisma.customerAiRule.updateMany({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (!res.count)
            throw new common_1.NotFoundException('Rule not found');
    }
};
exports.RulesService = RulesService;
exports.RulesService = RulesService = RulesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        instructions_service_1.InstructionsService])
], RulesService);
//# sourceMappingURL=rules.service.js.map