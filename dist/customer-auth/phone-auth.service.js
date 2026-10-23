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
var PhoneAuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneAuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const books_1 = require("../bookkeeping/books");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const prisma_service_1 = require("../prisma/prisma.service");
const code_mail_limiter_1 = require("./code-mail-limiter");
const customer_auth_service_1 = require("./customer-auth.service");
const phone_number_util_1 = require("./phone-number.util");
const sha256 = (code) => (0, crypto_1.createHash)('sha256').update(code).digest();
const EXPIRED = 'This code has expired. Please ask for a new one.';
const maskPhone = (e164) => `${e164.slice(0, 2)}${'•'.repeat(Math.max(0, e164.length - 5))}${e164.slice(-3)}`;
let PhoneAuthService = PhoneAuthService_1 = class PhoneAuthService {
    prisma;
    config;
    auth;
    messenger;
    logger = new common_1.Logger(PhoneAuthService_1.name);
    codes = new Map();
    limiter;
    constructor(prisma, config, auth, messenger) {
        this.prisma = prisma;
        this.config = config;
        this.auth = auth;
        this.messenger = messenger;
        const perHour = Number(this.config.get('CODE_MAIL_MAX_PER_HOUR'));
        this.limiter = new code_mail_limiter_1.CodeMailLimiter(Number.isFinite(perHour) && perHour > 0
            ? perHour
            : code_mail_limiter_1.CODE_MAIL_PER_HOUR_DEFAULT);
    }
    async requestCode(rawPhone, ip) {
        this.auth.throttle(ip);
        this.auth.note(ip);
        const phone = this.parse(rawPhone);
        this.prune();
        const accounts = await this.prisma.customer.findMany({
            where: { phoneE164: phone, deletedAt: null },
            select: { id: true },
            take: 2,
        });
        if (accounts.length !== 1) {
            this.logger.log(`login code NOT sent to=${maskPhone(phone)} ip=${ip} (${accounts.length ? 'several accounts' : 'no account'})`);
            return { phone };
        }
        const existing = this.codes.get(phone);
        if (existing && Date.now() - existing.sentAt < customer_auth_service_1.SIGNUP_RESEND_MS) {
            throw new common_1.HttpException('Please wait a minute before asking for another code.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        const verdict = this.limiter.check(phone);
        if (verdict !== 'ok') {
            this.logger.warn(`login code NOT sent (${verdict} limit) to=${maskPhone(phone)} ip=${ip}`);
            if (verdict === 'address') {
                throw new common_1.HttpException('Too many codes were sent to this number. Please try again later.', common_1.HttpStatus.TOO_MANY_REQUESTS);
            }
            throw new common_1.ServiceUnavailableException('We cannot send texts right now. Please try again later.');
        }
        const code = String((0, crypto_1.randomInt)(0, 1_000_000)).padStart(6, '0');
        const entry = {
            customerId: accounts[0].id,
            codeHash: sha256(code),
            expiresAt: Date.now() + customer_auth_service_1.SIGNUP_CODE_TTL_MS,
            tries: 0,
            sentAt: Date.now(),
        };
        this.limiter.record(phone);
        this.logger.log(`login code to=${maskPhone(phone)} ip=${ip}`);
        if (this.config.get('CUSTOMER_SIGNUP_LOG_CODE') === '1' &&
            process.env.NODE_ENV !== 'production') {
            this.logger.warn(`[dev] login code for ${phone}: ${code}`);
            this.codes.set(phone, entry);
            return { phone };
        }
        const outcome = await this.messenger.send({
            channel: 'SMS',
            to: phone,
            body: `${code} is your CYG Finance login code. It expires in ${customer_auth_service_1.SIGNUP_CODE_TTL_MS / 60_000} minutes. Don't share it with anyone.`,
            meta: { customerId: entry.customerId, purpose: 'LOGIN_CODE' },
        });
        if (outcome === 'opted-out') {
            throw new common_1.BadRequestException('This number texted STOP to us, so we cannot text it a code. Text START to our number, then try again.');
        }
        if (outcome !== 'sent') {
            this.logger.error(`login code text ${outcome} to=${maskPhone(phone)}`);
            throw new common_1.ServiceUnavailableException('We could not text you a code right now. Please try again later.');
        }
        this.codes.set(phone, entry);
        return { phone };
    }
    async verifyCode(rawPhone, code, ip) {
        this.auth.throttle(ip);
        const phone = this.parse(rawPhone);
        const entry = this.codes.get(phone);
        if (!entry || entry.expiresAt < Date.now()) {
            this.codes.delete(phone);
            throw new common_1.BadRequestException(EXPIRED);
        }
        if (!(0, crypto_1.timingSafeEqual)(sha256(code), entry.codeHash)) {
            this.auth.note(ip);
            entry.tries += 1;
            if (entry.tries >= customer_auth_service_1.SIGNUP_CODE_TRIES) {
                this.codes.delete(phone);
                throw new common_1.BadRequestException('Too many wrong codes. Please ask for a new one.');
            }
            throw new common_1.BadRequestException('That code is not right. Please try again.');
        }
        this.codes.delete(phone);
        const customer = await this.auth.findActive(entry.customerId);
        if (!customer || customer.phoneE164 !== phone) {
            throw new common_1.BadRequestException(EXPIRED);
        }
        return this.auth.issueFor(customer);
    }
    async signupByPhone(rawPhone, createdWith) {
        const phone = this.parse(rawPhone);
        const existing = await this.prisma.customer.findFirst({
            where: { phoneE164: phone, deletedAt: null },
            orderBy: { id: 'asc' },
            select: { id: true },
        });
        if (existing)
            return { customerId: existing.id, created: false };
        const customer = await this.prisma.customer.create({
            data: {
                name: '',
                email: null,
                authType: client_1.CustomerAuthType.PHONE,
                createdWith: client_1.CustomerCreatedWith[createdWith],
                phone,
                phoneE164: phone,
                preferredContact: createdWith === 'WHATSAPP' ? 'WHATSAPP' : 'SMS',
            },
        });
        await (0, books_1.ensureDefaultBook)(this.prisma, customer.id);
        this.logger.log(`account #${customer.id} opened by ${createdWith} for ${maskPhone(phone)}`);
        return { customerId: customer.id, created: true };
    }
    parse(raw) {
        const phone = (0, phone_number_util_1.toE164)(raw);
        if (!phone) {
            throw new common_1.BadRequestException('Enter a valid phone number (with the country code if outside Canada / the US)');
        }
        return phone;
    }
    prune() {
        const now = Date.now();
        for (const [key, entry] of this.codes) {
            if (entry.expiresAt < now)
                this.codes.delete(key);
        }
    }
};
exports.PhoneAuthService = PhoneAuthService;
exports.PhoneAuthService = PhoneAuthService = PhoneAuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        customer_auth_service_1.CustomerAuthService,
        customer_messenger_service_1.CustomerMessenger])
], PhoneAuthService);
//# sourceMappingURL=phone-auth.service.js.map