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
var SchedulesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulesService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const assistant_service_1 = require("../assistant/assistant.service");
const chart_of_accounts_1 = require("../bookkeeping/chart-of-accounts");
const file_links_1 = require("../bookkeeping/file-links");
const report_pdf_1 = require("../bookkeeping/report-pdf");
const reports_service_1 = require("../bookkeeping/reports.service");
const scope_1 = require("../bookkeeping/scope");
const tax_service_1 = require("../bookkeeping/tax.service");
const mail_service_1 = require("../mail/mail.service");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const prisma_service_1 = require("../prisma/prisma.service");
const next_run_util_1 = require("./next-run.util");
const schedule_messages_util_1 = require("./schedule-messages.util");
const DEFAULTS = {
    ACCOUNT_STATUS: {
        frequency: 'WEEKLY',
        weekday: 1,
        monthDay: null,
        time: '14:00',
    },
    FINANCIAL_REPORT: {
        frequency: 'MONTHLY',
        weekday: null,
        monthDay: 1,
        time: '09:00',
    },
};
const TYPES = ['ACCOUNT_STATUS', 'FINANCIAL_REPORT'];
const BATCH = 20;
const ruleOf = (s) => ({
    frequency: s.frequency === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY',
    weekday: s.weekday,
    monthDay: s.monthDay,
    time: s.time,
    timezone: s.timezone,
});
let SchedulesService = SchedulesService_1 = class SchedulesService {
    prisma;
    config;
    mail;
    messenger;
    links;
    reports;
    tax;
    assistant;
    logger = new common_1.Logger(SchedulesService_1.name);
    ticking = false;
    constructor(prisma, config, mail, messenger, links, reports, tax, assistant) {
        this.prisma = prisma;
        this.config = config;
        this.mail = mail;
        this.messenger = messenger;
        this.links = links;
        this.reports = reports;
        this.tax = tax;
        this.assistant = assistant;
    }
    async list(scope) {
        const rows = await Promise.all(TYPES.map((t) => this.ensure(scope, t)));
        const delivery = await this.delivery(scope.customerId);
        return Promise.all(rows.map((r) => this.view(r, delivery)));
    }
    async update(scope, type, input) {
        const row = await this.ensure(scope, type);
        const rule = {
            frequency: input.frequency ?? ruleOf(row).frequency,
            weekday: input.weekday !== undefined ? input.weekday : row.weekday,
            monthDay: input.monthDay !== undefined ? input.monthDay : row.monthDay,
            time: input.time ?? row.time,
            timezone: input.timezone ? (0, next_run_util_1.safeZone)(input.timezone) : row.timezone,
        };
        if (!(0, next_run_util_1.parseTime)(rule.time)) {
            throw new common_1.BadRequestException('Choose a time like 14:00');
        }
        if (rule.frequency === 'WEEKLY') {
            if (rule.weekday === null || rule.weekday < 0 || rule.weekday > 6) {
                throw new common_1.BadRequestException('Choose a day of the week');
            }
            rule.monthDay = null;
        }
        else {
            if (rule.monthDay === null || rule.monthDay < 0 || rule.monthDay > 28) {
                throw new common_1.BadRequestException('Choose a day of the month (1–28, or the last day)');
            }
            rule.weekday = null;
        }
        const enabled = input.enabled ?? row.enabled;
        const saved = await this.prisma.bookSchedule.update({
            where: { id: row.id },
            data: {
                ...rule,
                enabled,
                nextRunAt: enabled ? (0, next_run_util_1.nextRun)(rule, new Date()) : null,
            },
        });
        return this.view(saved, await this.delivery(scope.customerId));
    }
    async sendNow(scope, type) {
        const row = await this.ensure(scope, type);
        await this.run(row, true);
        const fresh = await this.prisma.bookSchedule.findUniqueOrThrow({
            where: { id: row.id },
        });
        return this.view(fresh, await this.delivery(scope.customerId));
    }
    async tick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            const now = new Date();
            const due = await this.prisma.bookSchedule.findMany({
                where: { enabled: true, nextRunAt: { lte: now } },
                orderBy: { nextRunAt: 'asc' },
                take: BATCH,
            });
            for (const s of due) {
                const claimed = await this.prisma.bookSchedule.updateMany({
                    where: { id: s.id, enabled: true, nextRunAt: s.nextRunAt },
                    data: { nextRunAt: (0, next_run_util_1.nextRun)(ruleOf(s), now), lastRunAt: now },
                });
                if (!claimed.count)
                    continue;
                await this.run(s, false).catch((err) => this.logger.error(`schedule #${s.id} FAILED: ${err instanceof Error ? err.message : String(err)}`));
            }
        }
        catch (err) {
            this.logger.error(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.ticking = false;
        }
    }
    async run(s, manual) {
        const scope = {
            customerId: s.customerId,
            companyId: s.companyId,
        };
        const record = (data) => this.prisma.bookScheduleRun.create({
            data: {
                scheduleId: s.id,
                manual,
                channel: data.channel,
                ok: data.ok,
                text: data.text?.slice(0, 20_000) ?? null,
                error: data.error?.slice(0, 512) ?? null,
            },
        });
        if (manual) {
            await this.prisma.bookSchedule.update({
                where: { id: s.id },
                data: { lastRunAt: new Date() },
            });
        }
        const live = await this.liveBook(scope);
        if (!live) {
            await this.prisma.bookSchedule.update({
                where: { id: s.id },
                data: { enabled: false, nextRunAt: null },
            });
            return record({
                channel: 'NONE',
                ok: false,
                error: 'This book no longer exists.',
            });
        }
        const delivery = await this.delivery(scope.customerId);
        if (!delivery.channel || !delivery.to) {
            return record({
                channel: 'NONE',
                ok: false,
                error: 'No email address or phone number to send to.',
            });
        }
        const firstName = live.customerName.trim().split(/\s+/)[0] ?? '';
        const compose = (sms) => this.compose(s, scope, { firstName, book: live.book }, sms);
        const first = await compose(delivery.channel === 'SMS');
        if ('skip' in first) {
            return record({ channel: 'NONE', ok: true, text: first.skip });
        }
        if (delivery.channel === 'SMS') {
            const outcome = await this.messenger.send({
                channel: 'SMS',
                to: delivery.to,
                body: first.text,
            });
            if (outcome === 'sent') {
                await this.logText(scope, delivery.to, first.text);
                return record({ channel: 'SMS', ok: true, text: first.text });
            }
            if (!live.email) {
                return record({
                    channel: 'SMS',
                    ok: false,
                    text: first.text,
                    error: `The text was not sent (${outcome}).`,
                });
            }
            const mail = await compose(false);
            if ('skip' in mail)
                return record({ channel: 'NONE', ok: true, text: mail.skip });
            const sent = await this.email(live.email, mail);
            return record({
                channel: 'EMAIL',
                ok: sent === null,
                text: mail.text,
                error: `The text was not sent (${outcome}), so it was emailed${sent ? ` — and the email failed: ${sent}` : ''}.`,
            });
        }
        const sent = await this.email(delivery.to, first);
        return record({
            channel: 'EMAIL',
            ok: sent === null,
            text: first.text,
            error: sent,
        });
    }
    async compose(s, scope, who, sms) {
        if (s.type === 'ACCOUNT_STATUS') {
            const status = await this.status(scope, s.lastRunAt);
            if ((0, schedule_messages_util_1.nothingOpen)(status))
                return { skip: 'Nothing to review — no message sent.' };
            return {
                ...(0, schedule_messages_util_1.accountStatusMessage)({
                    firstName: who.firstName,
                    book: who.book,
                    status,
                    link: this.dashboardLink(scope),
                    sms,
                }),
                attachments: [],
            };
        }
        const period = (0, next_run_util_1.previousMonth)(new Date(), s.timezone);
        const view = await this.reports.reports(scope, period.from, period.to);
        const is = view.incomeStatement;
        if (!is.income.length && !is.expenses.length) {
            return { skip: `No transactions in ${period.label} — no report sent.` };
        }
        const link = await this.links.link(scope, {
            kind: 'report',
            from: period.from,
            to: period.to,
        });
        const message = (0, schedule_messages_util_1.financialReportMessage)({
            firstName: who.firstName,
            book: who.book,
            period: period.label,
            income: is.totalIncome,
            expenses: is.totalExpenses,
            net: is.netIncome,
            uncategorized: view.uncategorized.count,
            link,
            sms,
        });
        return {
            ...message,
            attachments: sms
                ? []
                : [
                    {
                        filename: `Financial report ${period.label}.pdf`,
                        content: await (0, report_pdf_1.reportPdf)(view, who.book),
                        contentType: 'application/pdf',
                    },
                ],
        };
    }
    async email(to, m) {
        try {
            await this.mail.send({
                to,
                subject: m.subject,
                text: m.text,
                html: m.html,
                fromName: 'CYG Finance',
                attachments: m.attachments,
            });
            return null;
        }
        catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }
    async status(scope, since) {
        const book = (0, scope_1.scopeWhere)(scope);
        const from = since ?? new Date(Date.now() - 7 * 24 * 60 * 60_000);
        const [unmatchedFiles, newDocuments, uncategorized, statementsToReview, statementsWaiting, names,] = await Promise.all([
            this.prisma.transactionAttachment.count({
                where: {
                    ...book,
                    deletedAt: null,
                    status: { in: [client_1.AttachmentStatus.UNMATCHED, client_1.AttachmentStatus.FAILED] },
                },
            }),
            this.prisma.transactionAttachment.count({
                where: {
                    ...book,
                    deletedAt: null,
                    status: client_1.AttachmentStatus.DOCUMENT,
                    createdAt: { gte: from },
                },
            }),
            this.prisma.bankTransaction.count({
                where: {
                    ...book,
                    offsetAccount: chart_of_accounts_1.UNCATEGORIZED,
                    splitOfId: null,
                    statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
                },
            }),
            this.prisma.bankStatement.count({
                where: {
                    ...book,
                    deletedAt: null,
                    status: {
                        in: [client_1.StatementStatus.FAILED, client_1.StatementStatus.NEEDS_REVIEW],
                    },
                },
            }),
            this.prisma.bankStatement.count({
                where: { ...book, deletedAt: null, status: client_1.StatementStatus.UPLOADED },
            }),
            this.tax.names(scope).catch(() => null),
        ]);
        return {
            unmatchedFiles,
            newDocuments,
            uncategorized,
            unrecognizedNames: names?.unrecognized.length ?? 0,
            statementsToReview,
            statementsWaiting,
        };
    }
    async ensure(scope, type) {
        const found = await this.prisma.bookSchedule.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), type },
            orderBy: { id: 'asc' },
        });
        if (found)
            return found;
        return this.prisma.bookSchedule.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                type,
                ...DEFAULTS[type],
                timezone: next_run_util_1.DEFAULT_TIMEZONE,
                enabled: false,
            },
        });
    }
    async view(s, delivery) {
        const runs = await this.prisma.bookScheduleRun.findMany({
            where: { scheduleId: s.id },
            orderBy: { id: 'desc' },
            take: 5,
        });
        const rule = ruleOf(s);
        return {
            type: s.type,
            enabled: s.enabled,
            frequency: rule.frequency,
            weekday: s.weekday,
            monthDay: s.monthDay,
            time: s.time,
            timezone: s.timezone,
            description: (0, next_run_util_1.describeRule)(rule),
            nextRunAt: s.nextRunAt?.toISOString() ?? null,
            lastRunAt: s.lastRunAt?.toISOString() ?? null,
            delivery,
            runs: runs.map((r) => ({
                at: r.createdAt.toISOString(),
                channel: r.channel,
                ok: r.ok,
                error: r.error,
                manual: r.manual,
                text: r.text,
            })),
        };
    }
    async delivery(customerId) {
        const c = await this.prisma.customer.findUnique({
            where: { id: customerId },
            select: { email: true, phoneE164: true, preferredContact: true },
        });
        if (!c)
            return { channel: null, to: null, preferred: null };
        const wantsText = c.preferredContact === 'SMS' || c.preferredContact === 'WHATSAPP';
        if (wantsText && c.phoneE164 && this.messenger.smsConfigured) {
            return { channel: 'SMS', to: c.phoneE164, preferred: c.preferredContact };
        }
        return {
            channel: c.email ? 'EMAIL' : null,
            to: c.email ?? null,
            preferred: c.preferredContact,
        };
    }
    async liveBook(scope) {
        const customer = await this.prisma.customer.findFirst({
            where: { id: scope.customerId, deletedAt: null },
            select: { name: true, email: true },
        });
        if (!customer)
            return null;
        if (scope.companyId === null) {
            return {
                customerName: customer.name,
                email: customer.email,
                book: 'your personal books',
            };
        }
        const company = await this.prisma.company.findFirst({
            where: {
                id: scope.companyId,
                customerId: scope.customerId,
                isDraft: false,
                isInternal: false,
                deletedAt: null,
            },
            select: { businessName: true },
        });
        return company
            ? {
                customerName: customer.name,
                email: customer.email,
                book: company.businessName,
            }
            : null;
    }
    dashboardLink(scope) {
        const base = this.config.get('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
            'https://cygfinance.com';
        return scope.companyId === null
            ? `${base}/dashboard/bookkeeping`
            : `${base}/dashboard/businesses/${scope.companyId}`;
    }
    async logText(scope, phone, text) {
        try {
            const conversation = (await this.prisma.aiConversation.findFirst({
                where: {
                    customerId: scope.customerId,
                    channel: 'SMS',
                    peer: phone,
                    attachmentId: null,
                },
                orderBy: { id: 'desc' },
            })) ??
                (await this.prisma.aiConversation.create({
                    data: {
                        customerId: scope.customerId,
                        companyId: scope.companyId,
                        channel: 'SMS',
                        peer: phone,
                        bookChosen: true,
                    },
                }));
            await this.assistant.save(conversation, 'ASSISTANT', text);
        }
        catch (err) {
            this.logger.warn(`schedule text not logged: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    static typeOf(raw) {
        const t = raw.toUpperCase().replace(/-/g, '_');
        if (t === 'ACCOUNT_STATUS' || t === 'FINANCIAL_REPORT')
            return t;
        throw new common_1.NotFoundException('Unknown schedule');
    }
};
exports.SchedulesService = SchedulesService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulesService.prototype, "tick", null);
exports.SchedulesService = SchedulesService = SchedulesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        mail_service_1.MailService,
        customer_messenger_service_1.CustomerMessenger,
        file_links_1.FileLinkService,
        reports_service_1.ReportsService,
        tax_service_1.TaxService,
        assistant_service_1.AssistantService])
], SchedulesService);
//# sourceMappingURL=schedules.service.js.map