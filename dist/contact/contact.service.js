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
var ContactService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactService = exports.CONTACT_WINDOW_MS = exports.CONTACT_LIMIT = void 0;
exports.buildContactEmail = buildContactEmail;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mail_service_1 = require("../mail/mail.service");
exports.CONTACT_LIMIT = 5;
exports.CONTACT_WINDOW_MS = 15 * 60_000;
const FIELDS = [
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['company', 'Company'],
    ['title', 'Title'],
];
function oneLine(value) {
    return (value ?? '').replace(/[\r\n]+/g, ' ').trim();
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
let ContactService = ContactService_1 = class ContactService {
    mail;
    config;
    logger = new common_1.Logger(ContactService_1.name);
    hits = new Map();
    constructor(mail, config) {
        this.mail = mail;
        this.config = config;
    }
    async submit(dto, ip) {
        if (dto.website?.trim()) {
            this.logger.warn(`honeypot tripped from ${ip}; dropped`);
            return;
        }
        this.throttle(ip);
        if (!this.mail.configured) {
            this.logger.error('contact form submitted but SMTP_USER / SMTP_PASS are not set');
            throw new common_1.ServiceUnavailableException('Our contact form is temporarily unavailable. Please email office@cygfinance.com.');
        }
        const to = oneLine(this.config.get('CONTACT_TO')) || 'office@cygfinance.com';
        try {
            await this.mail.send({
                to,
                replyTo: oneLine(dto.email),
                ...buildContactEmail(dto),
            });
        }
        catch (err) {
            this.logger.error(`contact mail failed: ${err.message}`);
            throw new common_1.ServiceUnavailableException('We could not send your message. Please try again or email office@cygfinance.com.');
        }
    }
    throttle(ip) {
        const now = Date.now();
        const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < exports.CONTACT_WINDOW_MS);
        if (recent.length >= exports.CONTACT_LIMIT) {
            this.hits.set(ip, recent);
            throw new common_1.HttpException('Too many messages. Please try again later or email office@cygfinance.com.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        recent.push(now);
        this.hits.set(ip, recent);
        if (this.hits.size > 5000) {
            for (const [key, times] of this.hits) {
                if (times.every((t) => now - t >= exports.CONTACT_WINDOW_MS))
                    this.hits.delete(key);
            }
        }
    }
};
exports.ContactService = ContactService;
exports.ContactService = ContactService = ContactService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mail_service_1.MailService,
        config_1.ConfigService])
], ContactService);
function buildContactEmail(dto) {
    const name = `${oneLine(dto.firstName)} ${oneLine(dto.lastName)}`.trim();
    const company = oneLine(dto.company);
    const subject = `Website enquiry — ${name}${company ? ` (${company})` : ''}`;
    const message = (dto.message ?? '').trim();
    const text = [
        'New message from the cygfinance.com contact form.',
        '',
        ...FIELDS.map(([key, label]) => `${label}: ${oneLine(dto[key])}`),
        '',
        'Message:',
        message || '(none)',
    ].join('\n');
    const rows = FIELDS.map(([key, label]) => `<tr><td style="padding:4px 12px 4px 0;color:#555"><b>${label}</b></td>` +
        `<td style="padding:4px 0">${escapeHtml(oneLine(dto[key]))}</td></tr>`).join('');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
        `<p>New message from the cygfinance.com contact form.</p>` +
        `<table style="border-collapse:collapse">${rows}</table>` +
        `<p style="margin-top:16px"><b>Message:</b></p>` +
        `<p style="white-space:pre-wrap">${message ? escapeHtml(message) : '<i>(none)</i>'}</p>` +
        `</div>`;
    return { subject, text, html };
}
//# sourceMappingURL=contact.service.js.map