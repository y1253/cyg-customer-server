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
var OpenAiClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAiClient = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
let OpenAiClient = OpenAiClient_1 = class OpenAiClient {
    config;
    logger = new common_1.Logger(OpenAiClient_1.name);
    constructor(config) {
        this.config = config;
    }
    get configured() {
        return Boolean(this.config.get('OPENAI_API_KEY')?.trim());
    }
    async chat(req) {
        const key = this.config.get('OPENAI_API_KEY')?.trim();
        if (!key)
            throw new common_1.BadGatewayException('The AI service is not configured');
        const started = Date.now();
        let res;
        try {
            res = await fetch(CHAT_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: req.model,
                    temperature: req.temperature ?? 0,
                    max_tokens: req.maxTokens,
                    messages: [
                        { role: 'system', content: req.system },
                        { role: 'user', content: req.user },
                    ],
                    ...(req.jsonSchema && {
                        response_format: {
                            type: 'json_schema',
                            json_schema: {
                                name: req.jsonSchema.name,
                                strict: true,
                                schema: req.jsonSchema.schema,
                            },
                        },
                    }),
                }),
                signal: AbortSignal.timeout(req.timeoutMs),
            });
        }
        catch (err) {
            const reason = err instanceof Error ? err.name : 'error';
            this.logger.warn(`openai ${req.model} FAILED ${reason} ${Date.now() - started}ms`);
            throw new common_1.BadGatewayException('The AI service could not be reached');
        }
        const data = (await res.json().catch(() => null));
        this.logger.log(`openai ${req.model} ${res.status} ${Date.now() - started}ms`);
        if (!res.ok) {
            throw new common_1.BadGatewayException(data?.error?.message ?? `The AI service answered ${res.status}`);
        }
        const choice = data?.choices?.[0];
        if (choice?.message?.refusal) {
            throw new common_1.BadGatewayException('The AI declined to read this document');
        }
        if (choice?.finish_reason === 'length') {
            throw new common_1.BadGatewayException('The AI reply was cut off (document section too long)');
        }
        const content = choice?.message?.content?.trim();
        if (!content)
            throw new common_1.BadGatewayException('The AI returned an empty reply');
        return content;
    }
};
exports.OpenAiClient = OpenAiClient;
exports.OpenAiClient = OpenAiClient = OpenAiClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OpenAiClient);
//# sourceMappingURL=openai.client.js.map