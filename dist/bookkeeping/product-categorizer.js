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
exports.ProductCategorizer = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_client_1 = require("../ai/openai.client");
const chart_of_accounts_1 = require("./chart-of-accounts");
const PER_CALL = 100;
const SYSTEM_PROMPT = `You are a bookkeeper for a small business. Each item below is one line \
from a purchase receipt the business paid for. Choose the expense account each item belongs \
in, from the allowed list only. Judge by what the item IS (diapers, paper towels and cleaning \
products are Supplies; a printer cartridge is Office Expense; food at a restaurant is \
Meals & Entertainment; gas is Vehicle & Fuel; goods bought to resell are Cost of Goods Sold). \
The store and the transaction's own category are hints only. Answer "Uncategorized" when \
you truly cannot tell. Return every key you were given, exactly as given.`;
const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'category'],
                properties: {
                    key: { type: 'string' },
                    category: { type: 'string', enum: [...chart_of_accounts_1.ACCOUNT_NAMES] },
                },
            },
        },
    },
};
let ProductCategorizer = class ProductCategorizer {
    openai;
    config;
    constructor(openai, config) {
        this.openai = openai;
        this.config = config;
    }
    get configured() {
        return this.openai.configured;
    }
    model() {
        return (this.config.get('OPENAI_BOOKKEEPING_TAX_MODEL')?.trim() ||
            'gpt-4.1-mini');
    }
    async categorize(items, context = {}) {
        const out = new Map();
        const wanted = new Set(items.map((i) => i.key));
        for (let i = 0; i < items.length; i += PER_CALL) {
            const batch = items.slice(i, i + PER_CALL);
            const reply = await this.openai.chat({
                model: this.model(),
                system: SYSTEM_PROMPT + (context.rules ?? ''),
                user: `Store: ${context.store ?? 'unknown'}\n` +
                    `Transaction category: ${context.category ?? 'unknown'}\n\n` +
                    `Items:\n${JSON.stringify(batch)}`,
                jsonSchema: { name: 'product_categories', schema: SCHEMA },
                maxTokens: 60 * batch.length + 200,
                timeoutMs: 60_000,
            });
            const parsed = JSON.parse(reply);
            for (const a of parsed.items ?? []) {
                if (a.key && a.category && wanted.has(a.key))
                    out.set(a.key, a.category);
            }
        }
        return out;
    }
};
exports.ProductCategorizer = ProductCategorizer;
exports.ProductCategorizer = ProductCategorizer = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [openai_client_1.OpenAiClient,
        config_1.ConfigService])
], ProductCategorizer);
//# sourceMappingURL=product-categorizer.js.map