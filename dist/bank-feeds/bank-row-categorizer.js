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
exports.BankRowCategorizer = exports.SYSTEM_PROMPT = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_client_1 = require("../ai/openai.client");
const chart_of_accounts_1 = require("../bookkeeping/chart-of-accounts");
const statement_extractor_1 = require("../bookkeeping/statement-extractor");
const PER_CALL = 100;
exports.SYSTEM_PROMPT = `You are a bookkeeper for a small business. Each row below is \
one transaction from the business's bank or credit-card feed. For each row give:
- ${statement_extractor_1.NAME_RULE}
- category: the account it belongs in, from the allowed list only. Money in (amount > 0) is \
usually income or a transfer; money out (amount < 0) usually an expense. A payment to a \
credit card or a transfer between the owner's own accounts is "Transfer Between Accounts" or \
"Credit Card Payment" when those are in the list. "hint" is the bank's own category and only \
a hint. Answer "Uncategorized" when you truly cannot tell.
Return every key you were given, exactly as given.`;
const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['rows'],
    properties: {
        rows: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'name', 'category'],
                properties: {
                    key: { type: 'string' },
                    name: { type: ['string', 'null'] },
                    category: { type: 'string', enum: [...chart_of_accounts_1.ACCOUNT_NAMES] },
                },
            },
        },
    },
};
let BankRowCategorizer = class BankRowCategorizer {
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
    async categorize(rows, rules = '') {
        const out = new Map();
        const wanted = new Set(rows.map((r) => r.key));
        for (let i = 0; i < rows.length; i += PER_CALL) {
            const batch = rows.slice(i, i + PER_CALL);
            const reply = await this.openai.chat({
                model: this.model(),
                system: exports.SYSTEM_PROMPT + rules,
                user: `Rows:\n${JSON.stringify(batch)}`,
                jsonSchema: { name: 'bank_rows', schema: SCHEMA },
                maxTokens: 80 * batch.length + 200,
                timeoutMs: 90_000,
            });
            const parsed = JSON.parse(reply);
            for (const a of parsed.rows ?? []) {
                if (a.key && a.category && wanted.has(a.key)) {
                    out.set(a.key, {
                        name: a.name?.trim() || null,
                        category: a.category,
                    });
                }
            }
        }
        return out;
    }
};
exports.BankRowCategorizer = BankRowCategorizer;
exports.BankRowCategorizer = BankRowCategorizer = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [openai_client_1.OpenAiClient,
        config_1.ConfigService])
], BankRowCategorizer);
//# sourceMappingURL=bank-row-categorizer.js.map