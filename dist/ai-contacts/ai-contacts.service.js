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
exports.AiContactsService = exports.CONTACT_REPLY_WINDOW_MS = void 0;
exports.toContactView = toContactView;
const common_1 = require("@nestjs/common");
const phone_number_util_1 = require("../customer-auth/phone-number.util");
const prisma_service_1 = require("../prisma/prisma.service");
exports.CONTACT_REPLY_WINDOW_MS = 72 * 3600_000;
function toContactView(c) {
    return {
        id: c.id,
        name: c.name,
        phone: c.phoneE164,
        email: c.email,
        note: c.note,
        lastContactedAt: c.lastContactedAt,
        createdAt: c.createdAt,
    };
}
let AiContactsService = class AiContactsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(customerId) {
        const rows = await this.prisma.aiContact.findMany({
            where: { customerId, deletedAt: null },
            orderBy: { name: 'asc' },
        });
        return rows.map(toContactView);
    }
    async get(customerId, id) {
        const c = await this.prisma.aiContact.findFirst({
            where: { id, customerId, deletedAt: null },
        });
        if (!c)
            throw new common_1.NotFoundException('Contact not found');
        return c;
    }
    byPhone(customerId, phoneE164) {
        return this.prisma.aiContact.findFirst({
            where: { customerId, phoneE164, deletedAt: null },
            orderBy: { id: 'asc' },
        });
    }
    async create(customerId, input) {
        const data = this.clean(input, true);
        if (data.phoneE164) {
            const same = await this.byPhone(customerId, data.phoneE164);
            if (same) {
                throw new common_1.BadRequestException(`${same.name} already has this phone number`);
            }
        }
        const row = await this.prisma.aiContact.create({
            data: { customerId, name: data.name, ...data },
        });
        return toContactView(row);
    }
    async update(customerId, id, input) {
        await this.get(customerId, id);
        const data = this.clean(input, false);
        if (data.phoneE164) {
            const same = await this.byPhone(customerId, data.phoneE164);
            if (same && same.id !== id) {
                throw new common_1.BadRequestException(`${same.name} already has this phone number`);
            }
        }
        const row = await this.prisma.aiContact.update({
            where: { id },
            data,
        });
        return toContactView(row);
    }
    async remove(customerId, id) {
        await this.get(customerId, id);
        await this.prisma.aiContact.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    async save(customerId, input) {
        const phone = input.phone ? (0, phone_number_util_1.toE164)(input.phone) : null;
        const existing = phone ? await this.byPhone(customerId, phone) : null;
        return existing
            ? this.update(customerId, existing.id, input)
            : this.create(customerId, input);
    }
    async touched(id) {
        await this.prisma.aiContact.update({
            where: { id },
            data: { lastContactedAt: new Date() },
        });
    }
    clean(input, creating) {
        const out = {};
        if (input.name !== undefined) {
            const name = input.name.trim().slice(0, 120);
            if (!name)
                throw new common_1.BadRequestException('A contact needs a name');
            out.name = name;
        }
        else if (creating) {
            throw new common_1.BadRequestException('A contact needs a name');
        }
        if (input.phone !== undefined) {
            const raw = input.phone?.trim() || null;
            const e164 = raw ? (0, phone_number_util_1.toE164)(raw) : null;
            if (raw && !e164) {
                throw new common_1.BadRequestException('Enter a valid phone number (with the country code if outside Canada / the US)');
            }
            out.phoneE164 = e164;
        }
        if (input.email !== undefined) {
            out.email = input.email?.trim().toLowerCase() || null;
        }
        if (input.note !== undefined)
            out.note = input.note?.trim() || null;
        return out;
    }
};
exports.AiContactsService = AiContactsService;
exports.AiContactsService = AiContactsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiContactsService);
//# sourceMappingURL=ai-contacts.service.js.map