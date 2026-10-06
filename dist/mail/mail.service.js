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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var MailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer_1 = __importDefault(require("nodemailer"));
let MailService = MailService_1 = class MailService {
    config;
    logger = new common_1.Logger(MailService_1.name);
    transporter = null;
    constructor(config) {
        this.config = config;
    }
    get configured() {
        return !!this.user() && !!this.pass();
    }
    async send(opts) {
        if (!this.configured) {
            throw new Error('SMTP_USER / SMTP_PASS are not set');
        }
        const started = Date.now();
        await this.transport().sendMail({
            from: `"${this.config.get('SMTP_FROM_NAME') ?? 'CYG Finance website'}" <${this.user()}>`,
            to: opts.to,
            subject: opts.subject,
            text: opts.text,
            ...(opts.html ? { html: opts.html } : {}),
            ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        });
        this.logger.log(`sent mail to ${opts.to} in ${Date.now() - started}ms`);
    }
    user() {
        return (this.config.get('SMTP_USER') ?? '').trim();
    }
    pass() {
        return (this.config.get('SMTP_PASS') ?? '').replace(/\s+/g, '');
    }
    transport() {
        if (!this.transporter) {
            const port = Number(this.config.get('SMTP_PORT')) || 587;
            this.transporter = nodemailer_1.default.createTransport({
                host: this.config.get('SMTP_HOST') || 'smtp.gmail.com',
                port,
                secure: port === 465,
                requireTLS: port !== 465,
                auth: { user: this.user(), pass: this.pass() },
                connectionTimeout: 15_000,
                greetingTimeout: 15_000,
                socketTimeout: 20_000,
            });
        }
        return this.transporter;
    }
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailService);
//# sourceMappingURL=mail.service.js.map