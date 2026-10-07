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
exports.CustomerAuthService = exports.AUTH_WINDOW_MS = exports.AUTH_LIMIT = exports.CUSTOMER_TOKEN_TYPE = void 0;
exports.toPublicCustomer = toPublicCustomer;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const bcryptjs_1 = require("bcryptjs");
const google_auth_library_1 = require("google-auth-library");
const prisma_service_1 = require("../prisma/prisma.service");
exports.CUSTOMER_TOKEN_TYPE = 'customer';
const BCRYPT_COST = 12;
exports.AUTH_LIMIT = 5;
exports.AUTH_WINDOW_MS = 15 * 60_000;
const BAD_CREDENTIALS = 'Email or password is incorrect';
function toPublicCustomer(c) {
    return {
        id: c.id,
        name: c.name,
        email: c.email,
        authType: c.authType,
        avatarUrl: c.avatarUrl,
        phone: c.phone,
        createdAt: c.createdAt,
    };
}
let CustomerAuthService = CustomerAuthService_1 = class CustomerAuthService {
    prisma;
    jwt;
    config;
    logger = new common_1.Logger(CustomerAuthService_1.name);
    hits = new Map();
    googleClient = null;
    constructor(prisma, jwt, config) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
    }
    googleClientId() {
        return this.config.get('GOOGLE_CLIENT_ID')?.trim() || null;
    }
    async signup(dto, ip) {
        this.throttle(ip);
        this.note(ip);
        const email = dto.email.toLowerCase();
        const existing = await this.prisma.customer.findUnique({
            where: { email },
        });
        if (existing) {
            throw new common_1.ConflictException('An account with this email already exists — log in instead');
        }
        const customer = await this.prisma.customer.create({
            data: {
                name: dto.name,
                email,
                authType: client_1.CustomerAuthType.PASSWORD,
                passwordHash: await (0, bcryptjs_1.hash)(dto.password, BCRYPT_COST),
                lastLoginAt: new Date(),
            },
        });
        return this.sign(customer);
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
                avatarUrl: identity.picture,
                lastLoginAt: new Date(),
            },
        });
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
        if (dto.phone !== undefined)
            data.phone = dto.phone || null;
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
        config_1.ConfigService])
], CustomerAuthService);
//# sourceMappingURL=customer-auth.service.js.map