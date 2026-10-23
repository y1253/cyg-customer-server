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
var CustomerAuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerAuthService = exports.SIGNUP_RESEND_MS = exports.SIGNUP_CODE_TRIES = exports.SIGNUP_CODE_TTL_MS = exports.AUTH_WINDOW_MS = exports.AUTH_LIMIT = exports.CUSTOMER_TOKEN_TYPE = void 0;
exports.toPublicCustomer = toPublicCustomer;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const bcryptjs_1 = require("bcryptjs");
const crypto_1 = require("crypto");
const google_auth_library_1 = require("google-auth-library");
const books_1 = require("../bookkeeping/books");
const mail_service_1 = require("../mail/mail.service");
const code_mail_limiter_1 = require("./code-mail-limiter");
const prisma_service_1 = require("../prisma/prisma.service");
const phone_number_util_1 = require("./phone-number.util");
const password_reset_email_1 = require("./password-reset-email");
const signup_code_email_1 = require("./signup-code-email");
exports.CUSTOMER_TOKEN_TYPE = 'customer';
const BCRYPT_COST = 12;
exports.AUTH_LIMIT = 5;
exports.AUTH_WINDOW_MS = 15 * 60_000;
exports.SIGNUP_CODE_TTL_MS = 10 * 60_000;
exports.SIGNUP_CODE_TRIES = 5;
exports.SIGNUP_RESEND_MS = 60_000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 10_000;
const NOT_HUMAN = 'Please confirm you are human and try again.';
const sha256 = (code) => (0, crypto_1.createHash)('sha256').update(code).digest();
const CODE_EXPIRED = 'This code has expired. Please sign up again.';
const RESET_EXPIRED = 'This code has expired. Please ask for a new one.';
const NEEDS_EMAIL = 'Add an email to your account first — you sign in with your email and password';
const BAD_CREDENTIALS = 'Email or password is incorrect';
function toPublicCustomer(c) {
    return {
        id: c.id,
        name: c.name,
        email: c.email,
        authType: c.authType,
        createdWith: c.createdWith,
        hasPassword: c.passwordHash !== null,
        avatarUrl: c.avatarUrl,
        phone: c.phone,
        preferredContact: c.preferredContact,
        createdAt: c.createdAt,
    };
}
let CustomerAuthService = CustomerAuthService_1 = class CustomerAuthService {
    prisma;
    jwt;
    config;
    mail;
    logger = new common_1.Logger(CustomerAuthService_1.name);
    hits = new Map();
    pending = new Map();
    resets = new Map();
    emailCodes = new Map();
    googleClient = null;
    codeMails;
    constructor(prisma, jwt, config, mail) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
        this.mail = mail;
        const perHour = Number(this.config.get('CODE_MAIL_MAX_PER_HOUR'));
        this.codeMails = new code_mail_limiter_1.CodeMailLimiter(Number.isFinite(perHour) && perHour > 0
            ? perHour
            : code_mail_limiter_1.CODE_MAIL_PER_HOUR_DEFAULT);
    }
    turnstileSiteKey() {
        return this.config.get('TURNSTILE_SITE_KEY')?.trim() || null;
    }
    async verifyHuman(token, ip) {
        const secret = this.config.get('TURNSTILE_SECRET_KEY')?.trim();
        if (!secret)
            return;
        if (!token)
            throw new common_1.BadRequestException(NOT_HUMAN);
        let ok;
        try {
            const body = new URLSearchParams({ secret, response: token });
            if (ip && ip !== 'unknown')
                body.set('remoteip', ip);
            const res = await fetch(TURNSTILE_VERIFY_URL, {
                method: 'POST',
                body,
                signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
            });
            const out = (await res.json());
            ok = out.success === true;
            if (!ok) {
                this.logger.warn(`turnstile rejected ip=${ip} codes=${(out['error-codes'] ?? []).join(',')}`);
            }
        }
        catch (err) {
            this.logger.error(`turnstile check failed, letting it through: ${err.message}`);
            return;
        }
        if (!ok)
            throw new common_1.BadRequestException(NOT_HUMAN);
    }
    googleClientId() {
        return this.config.get('GOOGLE_CLIENT_ID')?.trim() || null;
    }
    async signup(dto, ip) {
        this.throttle(ip);
        this.note(ip);
        this.prunePending();
        const email = dto.email.toLowerCase();
        await this.assertEmailFree(email);
        const entry = {
            name: dto.name,
            email,
            passwordHash: await (0, bcryptjs_1.hash)(dto.password, BCRYPT_COST),
            codeHash: Buffer.alloc(0),
            expiresAt: 0,
            tries: 0,
            sentAt: 0,
        };
        this.pending.set(email, entry);
        await this.sendCode(entry, 'signup', ip);
        return { email };
    }
    async verifySignup(dto, ip) {
        this.throttle(ip);
        const email = dto.email.toLowerCase();
        const entry = this.livePending(email);
        if (!(0, crypto_1.timingSafeEqual)(sha256(dto.code), entry.codeHash)) {
            this.note(ip);
            entry.tries += 1;
            if (entry.tries >= exports.SIGNUP_CODE_TRIES) {
                this.pending.delete(email);
                throw new common_1.BadRequestException('Too many wrong codes. Please sign up again.');
            }
            throw new common_1.BadRequestException('That code is not right. Please try again.');
        }
        this.pending.delete(email);
        await this.assertEmailFree(email);
        const customer = await this.prisma.customer.create({
            data: {
                name: entry.name,
                email,
                authType: client_1.CustomerAuthType.PASSWORD,
                createdWith: client_1.CustomerCreatedWith.WEB_EMAIL,
                passwordHash: entry.passwordHash,
                lastLoginAt: new Date(),
            },
        });
        await (0, books_1.ensureDefaultBook)(this.prisma, customer.id);
        return this.sign(customer);
    }
    async resendSignupCode(dto, ip) {
        const entry = this.livePending(dto.email.toLowerCase());
        if (Date.now() - entry.sentAt < exports.SIGNUP_RESEND_MS) {
            throw new common_1.HttpException('Please wait a minute before asking for another code.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        await this.sendCode(entry, 'signup', ip);
        return { email: entry.email };
    }
    livePending(email) {
        const entry = this.pending.get(email);
        if (!entry || entry.expiresAt < Date.now()) {
            this.pending.delete(email);
            throw new common_1.BadRequestException(CODE_EXPIRED);
        }
        return entry;
    }
    async assertEmailFree(email) {
        const existing = await this.prisma.customer.findUnique({
            where: { email },
        });
        if (existing) {
            throw new common_1.ConflictException('An account with this email already exists — log in instead');
        }
    }
    async sendCode(entry, kind, ip, onLimit = 'throw') {
        const store = kind === 'signup'
            ? this.pending
            : kind === 'email'
                ? this.emailCodes
                : this.resets;
        const verdict = this.codeMails.check(entry.email);
        if (verdict !== 'ok') {
            if (entry.sentAt === 0)
                store.delete(entry.email);
            this.logger.warn(`${kind} code NOT sent (${verdict} limit) to=${(0, code_mail_limiter_1.maskEmail)(entry.email)} ip=${ip}`);
            if (onLimit === 'silent')
                return;
            if (verdict === 'address') {
                throw new common_1.HttpException('Too many codes were sent to this email. Please try again later.', common_1.HttpStatus.TOO_MANY_REQUESTS);
            }
            throw new common_1.ServiceUnavailableException('We cannot send emails right now. Please try again later.');
        }
        this.codeMails.record(entry.email);
        this.logger.log(`${kind} code to=${(0, code_mail_limiter_1.maskEmail)(entry.email)} ip=${ip}`);
        const code = String((0, crypto_1.randomInt)(0, 1_000_000)).padStart(6, '0');
        entry.codeHash = sha256(code);
        entry.expiresAt = Date.now() + exports.SIGNUP_CODE_TTL_MS;
        entry.tries = 0;
        entry.sentAt = Date.now();
        if (this.config.get('CUSTOMER_SIGNUP_LOG_CODE') === '1' &&
            process.env.NODE_ENV !== 'production') {
            this.logger.warn(`[dev] ${kind} code for ${entry.email}: ${code}`);
            return;
        }
        if (!this.mail.configured) {
            store.delete(entry.email);
            this.logger.error(`${kind} code not sent: SMTP_USER / SMTP_PASS are not set`);
            throw new common_1.ServiceUnavailableException(kind === 'signup'
                ? 'We could not send the verification email right now. Please try again later.'
                : 'We could not send the email right now. Please try again later.');
        }
        const minutes = exports.SIGNUP_CODE_TTL_MS / 60_000;
        try {
            await this.mail.send({
                to: entry.email,
                fromName: 'CYG Finance',
                ...(kind === 'signup'
                    ? (0, signup_code_email_1.buildSignupCodeEmail)(code, minutes)
                    : kind === 'email'
                        ? (0, signup_code_email_1.buildEmailConfirmCodeEmail)(code, minutes)
                        : (0, password_reset_email_1.buildPasswordCodeEmail)(code, minutes)),
            });
        }
        catch (err) {
            store.delete(entry.email);
            this.logger.error(`${kind} code mail failed: ${err.message}`);
            throw new common_1.ServiceUnavailableException(kind === 'signup'
                ? 'We could not send the verification email. Please check the address and try again.'
                : 'We could not send the email. Please try again later.');
        }
    }
    prunePending() {
        const now = Date.now();
        const stores = [
            this.pending,
            this.resets,
            this.emailCodes,
        ];
        for (const store of stores) {
            for (const [key, entry] of store) {
                if (entry.expiresAt < now)
                    store.delete(key);
            }
        }
    }
    async forgotPassword(dto, ip) {
        this.throttle(ip);
        this.note(ip);
        this.prunePending();
        const email = dto.email.toLowerCase();
        const customer = await this.prisma.customer.findUnique({
            where: { email },
        });
        if (customer && !customer.deletedAt) {
            await this.issuePasswordCode(email, ip, 'silent');
        }
        return { email };
    }
    async resetPassword(dto, ip) {
        this.throttle(ip);
        const email = dto.email.toLowerCase();
        this.checkPasswordCode(email, dto.code, ip);
        const customer = await this.prisma.customer.findUnique({
            where: { email },
        });
        if (!customer || customer.deletedAt) {
            throw new common_1.BadRequestException(RESET_EXPIRED);
        }
        const updated = await this.prisma.customer.update({
            where: { id: customer.id },
            data: {
                ...(await this.passwordData(dto.newPassword)),
                lastLoginAt: new Date(),
            },
        });
        return this.sign(updated);
    }
    async changePassword(customerId, dto, ip) {
        this.throttle(ip);
        const customer = await this.findActive(customerId);
        if (!customer)
            throw new common_1.UnauthorizedException();
        if (customer.passwordHash) {
            if (!dto.currentPassword) {
                throw new common_1.BadRequestException('Enter your current password');
            }
            if (!(await (0, bcryptjs_1.compare)(dto.currentPassword, customer.passwordHash))) {
                this.note(ip);
                throw new common_1.BadRequestException('Current password is incorrect');
            }
            if (dto.currentPassword === dto.newPassword) {
                throw new common_1.BadRequestException('Choose a password different from your current one');
            }
        }
        else {
            if (!customer.email)
                throw new common_1.BadRequestException(NEEDS_EMAIL);
            if (!dto.code) {
                throw new common_1.BadRequestException('Enter the 6-digit code from the email');
            }
            this.checkPasswordCode(customer.email, dto.code, ip);
        }
        const updated = await this.prisma.customer.update({
            where: { id: customer.id },
            data: await this.passwordData(dto.newPassword),
        });
        return this.sign(updated);
    }
    async sendPasswordCode(customerId, ip) {
        const customer = await this.findActive(customerId);
        if (!customer)
            throw new common_1.UnauthorizedException();
        if (customer.passwordHash) {
            throw new common_1.BadRequestException('Your account already has a password — enter it to change it');
        }
        if (!customer.email)
            throw new common_1.BadRequestException(NEEDS_EMAIL);
        this.prunePending();
        await this.issuePasswordCode(customer.email, ip, 'throw');
        return { email: customer.email };
    }
    async sendEmailCode(customerId, rawEmail, ip) {
        this.throttle(ip);
        const customer = await this.findActive(customerId);
        if (!customer)
            throw new common_1.UnauthorizedException();
        if (customer.email) {
            throw new common_1.BadRequestException('Your account already has an email');
        }
        const email = rawEmail.toLowerCase();
        await this.assertEmailFree(email);
        this.prunePending();
        const existing = this.emailCodes.get(email);
        if (existing && Date.now() - existing.sentAt < exports.SIGNUP_RESEND_MS) {
            throw new common_1.HttpException('Please wait a minute before asking for another code.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        const entry = {
            customerId,
            email,
            codeHash: Buffer.alloc(0),
            expiresAt: 0,
            tries: 0,
            sentAt: 0,
        };
        this.emailCodes.set(email, entry);
        await this.sendCode(entry, 'email', ip);
        return { email };
    }
    async verifyEmail(customerId, rawEmail, code, ip) {
        this.throttle(ip);
        const email = rawEmail.toLowerCase();
        const entry = this.emailCodes.get(email);
        if (!entry ||
            entry.customerId !== customerId ||
            entry.expiresAt < Date.now()) {
            throw new common_1.BadRequestException(RESET_EXPIRED);
        }
        if (!(0, crypto_1.timingSafeEqual)(sha256(code), entry.codeHash)) {
            this.note(ip);
            entry.tries += 1;
            if (entry.tries >= exports.SIGNUP_CODE_TRIES) {
                this.emailCodes.delete(email);
                throw new common_1.BadRequestException('Too many wrong codes. Please ask for a new one.');
            }
            throw new common_1.BadRequestException('That code is not right. Please try again.');
        }
        this.emailCodes.delete(email);
        await this.assertEmailFree(email);
        const updated = await this.prisma.customer.update({
            where: { id: customerId },
            data: { email },
        });
        return toPublicCustomer(updated);
    }
    async issuePasswordCode(email, ip, onLimit) {
        const existing = this.resets.get(email);
        if (existing && Date.now() - existing.sentAt < exports.SIGNUP_RESEND_MS) {
            throw new common_1.HttpException('Please wait a minute before asking for another code.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        const entry = existing ?? {
            email,
            codeHash: Buffer.alloc(0),
            expiresAt: 0,
            tries: 0,
            sentAt: 0,
        };
        this.resets.set(email, entry);
        await this.sendCode(entry, 'password', ip, onLimit);
    }
    checkPasswordCode(email, code, ip) {
        const entry = this.resets.get(email);
        if (!entry || entry.expiresAt < Date.now()) {
            this.resets.delete(email);
            throw new common_1.BadRequestException(RESET_EXPIRED);
        }
        if (!(0, crypto_1.timingSafeEqual)(sha256(code), entry.codeHash)) {
            this.note(ip);
            entry.tries += 1;
            if (entry.tries >= exports.SIGNUP_CODE_TRIES) {
                this.resets.delete(email);
                throw new common_1.BadRequestException('Too many wrong codes. Please ask for a new one.');
            }
            throw new common_1.BadRequestException('That code is not right. Please try again.');
        }
        this.resets.delete(email);
    }
    async passwordData(password) {
        return {
            passwordHash: await (0, bcryptjs_1.hash)(password, BCRYPT_COST),
            passwordChangedAt: new Date(),
        };
    }
    async login(dto, ip) {
        this.throttle(ip);
        const email = dto.email.toLowerCase();
        const customer = await this.prisma.customer.findUnique({
            where: { email },
        });
        if (!customer || customer.deletedAt) {
            this.note(ip);
            throw new common_1.UnauthorizedException(BAD_CREDENTIALS);
        }
        if (!customer.passwordHash) {
            throw new common_1.UnauthorizedException('This account uses Sign in with Google');
        }
        if (!(await (0, bcryptjs_1.compare)(dto.password, customer.passwordHash))) {
            this.note(ip);
            throw new common_1.UnauthorizedException(BAD_CREDENTIALS);
        }
        return this.issue(customer);
    }
    async google(dto) {
        const identity = await this.verifyGoogleCredential(dto.credential);
        if (!identity.emailVerified) {
            throw new common_1.UnauthorizedException('Your Google account email is not verified');
        }
        const email = identity.email.toLowerCase();
        const existing = await this.prisma.customer.findUnique({
            where: { email },
        });
        if (existing?.deletedAt) {
            throw new common_1.UnauthorizedException('This account has been closed');
        }
        if (existing) {
            if (!existing.avatarUrl && identity.picture) {
                const updated = await this.prisma.customer.update({
                    where: { id: existing.id },
                    data: { avatarUrl: identity.picture },
                });
                return this.issue(updated);
            }
            return this.issue(existing);
        }
        const created = await this.prisma.customer.create({
            data: {
                name: identity.name || email.split('@')[0],
                email,
                authType: client_1.CustomerAuthType.GOOGLE,
                createdWith: client_1.CustomerCreatedWith.GOOGLE,
                avatarUrl: identity.picture,
                lastLoginAt: new Date(),
            },
        });
        await (0, books_1.ensureDefaultBook)(this.prisma, created.id);
        return this.sign(created);
    }
    async findActive(id) {
        const customer = await this.prisma.customer.findUnique({ where: { id } });
        return customer && !customer.deletedAt ? customer : null;
    }
    async me(id) {
        const customer = await this.findActive(id);
        if (!customer)
            throw new common_1.UnauthorizedException();
        return toPublicCustomer(customer);
    }
    async updateMe(id, dto) {
        const data = {};
        if (dto.name !== undefined)
            data.name = dto.name;
        if (dto.phone !== undefined) {
            data.phone = dto.phone || null;
            data.phoneE164 = (0, phone_number_util_1.toE164)(dto.phone);
            if (data.phoneE164 && (await this.phoneTaken(data.phoneE164, id))) {
                throw new common_1.BadRequestException('This phone number is already on another CYG Finance account');
            }
        }
        const before = await this.findActive(id);
        if (before && !before.email && dto.phone !== undefined && !data.phoneE164) {
            throw new common_1.BadRequestException('You sign in with this phone number — add an email before removing it');
        }
        if (dto.preferredContact !== undefined) {
            data.preferredContact = dto.preferredContact;
        }
        const current = await this.prisma.customer.findUnique({ where: { id } });
        const method = dto.preferredContact !== undefined
            ? dto.preferredContact
            : current?.preferredContact;
        const phone = dto.phone !== undefined ? data.phone : current?.phone;
        if ((method === 'SMS' || method === 'WHATSAPP' || method === 'CALL') &&
            !phone)
            throw new common_1.BadRequestException('Add your phone number to be contacted by text, WhatsApp or phone call');
        const customer = await this.prisma.customer.update({
            where: { id },
            data,
        });
        return toPublicCustomer(customer);
    }
    async verifyGoogleCredential(credential) {
        const clientId = this.googleClientId();
        if (!clientId) {
            throw new common_1.ServiceUnavailableException('Sign in with Google is not available right now');
        }
        this.googleClient ??= new google_auth_library_1.OAuth2Client(clientId);
        let payload;
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken: credential,
                audience: clientId,
            });
            payload = ticket.getPayload();
        }
        catch (err) {
            this.logger.warn(`Google ID token rejected: ${err instanceof Error ? err.message : String(err)}`);
            throw new common_1.UnauthorizedException('Google sign-in failed — please try again');
        }
        if (!payload?.email) {
            throw new common_1.UnauthorizedException('Google did not share an email address');
        }
        return {
            email: payload.email,
            emailVerified: payload.email_verified === true,
            name: payload.name ?? null,
            picture: payload.picture ?? null,
        };
    }
    async phoneTaken(phoneE164, exceptId) {
        const other = await this.prisma.customer.findFirst({
            where: {
                phoneE164,
                deletedAt: null,
                ...(exceptId ? { id: { not: exceptId } } : {}),
            },
            select: { id: true },
        });
        return !!other;
    }
    issueFor(customer) {
        return this.issue(customer);
    }
    async issue(customer) {
        const updated = await this.prisma.customer.update({
            where: { id: customer.id },
            data: { lastLoginAt: new Date() },
        });
        return this.sign(updated);
    }
    sign(customer) {
        const payload = {
            sub: customer.id,
            email: customer.email,
            name: customer.name,
            typ: exports.CUSTOMER_TOKEN_TYPE,
        };
        return {
            access_token: this.jwt.sign(payload),
            customer: toPublicCustomer(customer),
        };
    }
    throttle(ip) {
        const now = Date.now();
        const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < exports.AUTH_WINDOW_MS);
        this.hits.set(ip, recent);
        if (recent.length >= exports.AUTH_LIMIT) {
            throw new common_1.HttpException('Too many attempts. Please wait a few minutes and try again.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
    }
    note(ip) {
        const list = this.hits.get(ip) ?? [];
        list.push(Date.now());
        this.hits.set(ip, list);
        if (this.hits.size > 5000) {
            const cutoff = Date.now() - exports.AUTH_WINDOW_MS;
            for (const [key, times] of this.hits) {
                if (!times.some((t) => t > cutoff))
                    this.hits.delete(key);
            }
        }
    }
};
exports.CustomerAuthService = CustomerAuthService;
exports.CustomerAuthService = CustomerAuthService = CustomerAuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService,
        mail_service_1.MailService])
], CustomerAuthService);
//# sourceMappingURL=customer-auth.service.js.map