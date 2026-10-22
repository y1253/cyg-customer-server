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
var InstructionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstructionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const instructions_builtin_1 = require("./instructions-builtin");
const instructions_util_1 = require("./instructions.util");
const CACHE_MS = 60_000;
let InstructionsService = InstructionsService_1 = class InstructionsService {
    prisma;
    logger = new common_1.Logger(InstructionsService_1.name);
    cache = null;
    constructor(prisma) {
        this.prisma = prisma;
    }
    onModuleInit() {
        void this.syncBuiltins().catch((err) => this.logger.warn(`instruction sync failed: ${err instanceof Error ? err.message : err}`));
    }
    async syncBuiltins() {
        const rows = await this.prisma.aiInstruction.findMany({
            select: {
                id: true,
                key: true,
                text: true,
                changes: { orderBy: { id: 'desc' }, take: 1, select: { by: true } },
            },
        });
        const plan = (0, instructions_builtin_1.planSync)(rows.map((r) => ({
            id: r.id,
            key: r.key,
            text: r.text,
            lastChangeBy: r.changes[0]?.by ?? null,
        })));
        for (const b of plan.create) {
            await this.prisma.aiInstruction
                .create({
                data: {
                    key: b.key,
                    target: 'ASSISTANT',
                    title: b.title,
                    text: b.text,
                    isStrong: b.isStrong,
                    locked: b.locked,
                    sortOrder: b.sortOrder,
                    changes: {
                        create: {
                            action: 'CREATE',
                            afterText: b.text,
                            by: 'SEED',
                            reason: 'Built-in instruction',
                        },
                    },
                },
            })
                .catch(() => undefined);
        }
        for (const { row, to } of plan.update) {
            await this.prisma.aiInstruction.update({
                where: { id: row.id },
                data: {
                    text: to.text,
                    title: to.title,
                    changes: {
                        create: {
                            action: 'UPDATE',
                            beforeText: row.text,
                            afterText: to.text,
                            by: 'SEED',
                            reason: 'Built-in instruction updated in the code',
                        },
                    },
                },
            });
        }
        if (plan.create.length || plan.update.length) {
            this.cache = null;
            this.logger.log(`instructions synced: ${plan.create.length} added, ${plan.update.length} updated`);
        }
        return { created: plan.create.length, updated: plan.update.length };
    }
    async rows() {
        if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
            return this.cache.rows;
        }
        try {
            const rows = await this.prisma.aiInstruction.findMany({
                where: { deletedAt: null },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            });
            this.cache = { at: Date.now(), rows };
            return rows;
        }
        catch (err) {
            this.logger.warn(`instructions read failed: ${err instanceof Error ? err.message : err}`);
            return this.cache?.rows ?? [];
        }
    }
    async assistant() {
        const rows = await this.rows();
        return rows.length ? (0, instructions_util_1.assistantTexts)(rows) : instructions_util_1.NO_TEXTS;
    }
    async block(target) {
        return (0, instructions_util_1.extrasBlock)(await this.rows(), target);
    }
    async strong() {
        return (await this.rows()).filter((r) => r.isStrong);
    }
    async regular() {
        return (await this.rows()).filter((r) => !r.isStrong);
    }
    async history(instructionId, take = 20) {
        return this.prisma.aiInstructionChange.findMany({
            where: { instructionId },
            orderBy: { id: 'desc' },
            take,
        });
    }
    async editable(key) {
        if (instructions_util_1.LOCKED_KEYS.includes(key) || key.startsWith('strong.')) {
            throw new common_1.ForbiddenException(`"${key}" can only be changed by staff`);
        }
        const row = await this.prisma.aiInstruction.findUnique({ where: { key } });
        if (row && (row.locked || row.isStrong)) {
            throw new common_1.ForbiddenException(`"${key}" can only be changed by staff`);
        }
        return row && !row.deletedAt ? row : null;
    }
    async update(key, text, who, currentText) {
        const clean = (0, instructions_util_1.cleanInstructionText)(text);
        if (clean === null)
            throw new common_1.BadRequestException('Text is empty');
        const row = await this.editable(key);
        if (!row && !(0, instructions_util_1.isFixedKey)(key)) {
            throw new common_1.NotFoundException(`No instruction "${key}"`);
        }
        const saved = await this.prisma.$transaction(async (tx) => {
            const next = row
                ? await tx.aiInstruction.update({
                    where: { id: row.id },
                    data: { text: clean },
                })
                : await tx.aiInstruction.upsert({
                    where: { key },
                    update: { text: clean, deletedAt: null },
                    create: {
                        key,
                        target: 'ASSISTANT',
                        title: key,
                        text: clean,
                        sortOrder: 10,
                    },
                });
            await tx.aiInstructionChange.create({
                data: {
                    instructionId: next.id,
                    action: 'UPDATE',
                    beforeText: row?.text ?? currentText ?? null,
                    afterText: clean,
                    ...this.changeData(who),
                },
            });
            return next;
        });
        this.cache = null;
        return saved;
    }
    async create(input, who) {
        const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '';
        const text = (0, instructions_util_1.cleanInstructionText)(input.text);
        if (!title || text === null) {
            throw new common_1.BadRequestException('Title and text are required');
        }
        const target = (0, instructions_util_1.isInstructionTarget)(input.target)
            ? input.target
            : 'ASSISTANT';
        let key = (0, instructions_util_1.extraKeyFor)(title);
        const taken = await this.prisma.aiInstruction.findUnique({
            where: { key },
        });
        if (taken)
            key = `${key.slice(0, 54)}-${Date.now().toString(36)}`;
        const saved = await this.prisma.$transaction(async (tx) => {
            const row = await tx.aiInstruction.create({
                data: { key, target, title, text, sortOrder: 200 },
            });
            await tx.aiInstructionChange.create({
                data: {
                    instructionId: row.id,
                    action: 'CREATE',
                    afterText: text,
                    ...this.changeData(who),
                },
            });
            return row;
        });
        this.cache = null;
        return saved;
    }
    async remove(key, who) {
        if (!(0, instructions_util_1.isExtraKey)(key)) {
            throw new common_1.ForbiddenException(`"${key}" is a fixed block — rewrite it with update_instruction instead`);
        }
        const row = await this.editable(key);
        if (!row)
            throw new common_1.NotFoundException(`No instruction "${key}"`);
        await this.prisma.$transaction([
            this.prisma.aiInstruction.update({
                where: { id: row.id },
                data: { deletedAt: new Date() },
            }),
            this.prisma.aiInstructionChange.create({
                data: {
                    instructionId: row.id,
                    action: 'DELETE',
                    beforeText: row.text,
                    ...this.changeData(who),
                },
            }),
        ]);
        this.cache = null;
    }
    changeData(who) {
        return {
            by: who.by,
            reason: who.reason.slice(0, 2000),
            escalationId: who.escalationId ?? null,
            staffUserId: who.staffUserId ?? null,
        };
    }
};
exports.InstructionsService = InstructionsService;
exports.InstructionsService = InstructionsService = InstructionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InstructionsService);
//# sourceMappingURL=instructions.service.js.map