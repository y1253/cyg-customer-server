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
exports.AiSchedulesStore = exports.aiRuleOf = exports.MAX_AI_SCHEDULES = exports.AI_SCHEDULE_CHANNELS = void 0;
const common_1 = require("@nestjs/common");
const scope_1 = require("../bookkeeping/scope");
const prisma_service_1 = require("../prisma/prisma.service");
const next_run_util_1 = require("./next-run.util");
exports.AI_SCHEDULE_CHANNELS = [
    'EMAIL',
    'SMS',
];
exports.MAX_AI_SCHEDULES = 20;
const aiRuleOf = (s) => ({
    frequency: s.frequency === 'DAILY' || s.frequency === 'MONTHLY'
        ? s.frequency
        : 'WEEKLY',
    weekday: s.weekday,
    monthDay: s.monthDay,
    time: s.time,
    timezone: s.timezone,
});
exports.aiRuleOf = aiRuleOf;
const isChannel = (c) => c === 'EMAIL' || c === 'SMS';
let AiSchedulesStore = class AiSchedulesStore {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    list(scope) {
        return this.prisma.aiSchedule.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            orderBy: { id: 'asc' },
        });
    }
    async get(scope, id) {
        const row = await this.prisma.aiSchedule.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!row)
            throw new common_1.NotFoundException('Schedule not found');
        return row;
    }
    async create(scope, input, meta) {
        const count = await this.prisma.aiSchedule.count({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (count >= exports.MAX_AI_SCHEDULES) {
            throw new common_1.BadRequestException(`This book already has ${exports.MAX_AI_SCHEDULES} schedules — delete one first.`);
        }
        const title = input.title?.trim();
        const task = input.task?.trim();
        if (!title)
            throw new common_1.BadRequestException('Give the schedule a short title');
        if (!task) {
            throw new common_1.BadRequestException('Say what should be sent each time (the task)');
        }
        const rule = this.rule({
            frequency: input.frequency ?? 'DAILY',
            weekday: input.weekday ?? null,
            monthDay: input.monthDay ?? null,
            time: input.time ?? '09:00',
            timezone: input.timezone
                ? (0, next_run_util_1.safeZone)(input.timezone)
                : await this.bookZone(scope),
        }, input);
        const active = input.active ?? true;
        return this.prisma.aiSchedule.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                title: title.slice(0, 120),
                task: task.slice(0, 4000),
                ...rule,
                channel: this.channel(input.channel),
                active,
                createdBy: meta.createdBy,
                conversationId: meta.conversationId ?? null,
                nextRunAt: active ? (0, next_run_util_1.nextRun)(rule, new Date()) : null,
            },
        });
    }
    async update(scope, id, input) {
        const row = await this.get(scope, id);
        const rule = this.rule((0, exports.aiRuleOf)(row), input);
        const active = input.active ?? row.active;
        const title = input.title !== undefined ? input.title.trim() : row.title;
        const task = input.task !== undefined ? input.task.trim() : row.task;
        if (!title)
            throw new common_1.BadRequestException('Give the schedule a short title');
        if (!task)
            throw new common_1.BadRequestException('The task cannot be empty');
        return this.prisma.aiSchedule.update({
            where: { id: row.id },
            data: {
                title: title.slice(0, 120),
                task: task.slice(0, 4000),
                ...rule,
                channel: input.channel !== undefined
                    ? this.channel(input.channel)
                    : row.channel,
                active,
                nextRunAt: active ? (0, next_run_util_1.nextRun)(rule, new Date()) : null,
            },
        });
    }
    async remove(scope, id) {
        const row = await this.get(scope, id);
        return this.prisma.aiSchedule.update({
            where: { id: row.id },
            data: { deletedAt: new Date(), active: false, nextRunAt: null },
        });
    }
    describe(s) {
        return (0, next_run_util_1.describeRule)((0, exports.aiRuleOf)(s));
    }
    rule(base, input) {
        const rule = {
            frequency: input.frequency ?? base.frequency,
            weekday: input.weekday !== undefined ? input.weekday : base.weekday,
            monthDay: input.monthDay !== undefined ? input.monthDay : base.monthDay,
            time: input.time?.trim() ?? base.time,
            timezone: input.timezone ? (0, next_run_util_1.safeZone)(input.timezone) : base.timezone,
        };
        if (!next_run_util_1.AI_FREQUENCIES.includes(rule.frequency)) {
            throw new common_1.BadRequestException('Repeat must be DAILY, WEEKLY or MONTHLY');
        }
        if (!(0, next_run_util_1.parseTime)(rule.time)) {
            throw new common_1.BadRequestException('Choose a time like 06:00 (24 h)');
        }
        if (rule.frequency === 'DAILY') {
            rule.weekday = null;
            rule.monthDay = null;
        }
        else if (rule.frequency === 'WEEKLY') {
            if (rule.weekday === null || rule.weekday < 0 || rule.weekday > 6) {
                throw new common_1.BadRequestException('Choose a day of the week (0 = Sunday … 6 = Saturday)');
            }
            rule.monthDay = null;
        }
        else {
            if (rule.monthDay === null || rule.monthDay < 0 || rule.monthDay > 28) {
                throw new common_1.BadRequestException('Choose a day of the month (1–28, or 0 = the last day)');
            }
            rule.weekday = null;
        }
        return rule;
    }
    channel(c) {
        if (c === null || c === undefined || c === '')
            return null;
        if (!isChannel(c)) {
            throw new common_1.BadRequestException('Send by EMAIL or SMS (or leave it empty)');
        }
        return c;
    }
    async bookZone(scope) {
        const s = await this.prisma.bookSchedule.findFirst({
            where: (0, scope_1.scopeWhere)(scope),
            orderBy: { updatedAt: 'desc' },
            select: { timezone: true },
        });
        return (0, next_run_util_1.safeZone)(s?.timezone ?? next_run_util_1.DEFAULT_TIMEZONE);
    }
};
exports.AiSchedulesStore = AiSchedulesStore;
exports.AiSchedulesStore = AiSchedulesStore = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiSchedulesStore);
//# sourceMappingURL=ai-schedules.store.js.map