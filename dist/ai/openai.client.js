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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var OpenAiClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAiClient = void 0;
exports.agentBody = agentBody;
exports.responsesBody = responsesBody;
exports.parseResponsesOutput = parseResponsesOutput;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ai_usage_service_1 = require("../ai-usage/ai-usage.service");
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
function agentBody(req) {
    return {
        model: req.model,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens,
        messages: req.messages.map((m) => {
            if (m.role === 'tool') {
                return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
            }
            if (m.role === 'assistant') {
                return {
                    role: 'assistant',
                    content: m.content,
                    ...(m.toolCalls?.length && {
                        tool_calls: m.toolCalls.map((c) => ({
                            id: c.id,
                            type: 'function',
                            function: { name: c.name, arguments: c.arguments },
                        })),
                    }),
                };
            }
            return { role: m.role, content: m.content };
        }),
        ...(req.tools?.length && {
            tools: req.tools.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            })),
            tool_choice: 'auto',
        }),
    };
}
function responsesBody(req) {
    const instructions = req.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
    const input = req.messages.flatMap((m) => {
        switch (m.role) {
            case 'system':
                return [];
            case 'user':
                return [{ role: 'user', content: m.content }];
            case 'tool':
                return [
                    {
                        type: 'function_call_output',
                        call_id: m.toolCallId,
                        output: m.content,
                    },
                ];
            case 'assistant':
                return [
                    ...(m.content ? [{ role: 'assistant', content: m.content }] : []),
                    ...(m.toolCalls ?? []).map((c) => ({
                        type: 'function_call',
                        call_id: c.id,
                        name: c.name,
                        arguments: c.arguments,
                    })),
                ];
        }
    });
    return {
        model: req.model,
        store: false,
        ...(instructions && { instructions }),
        input,
        ...(req.reasoningEffort
            ? { reasoning: { effort: req.reasoningEffort } }
            : { temperature: req.temperature ?? 0.2 }),
        ...(req.maxTokens && { max_output_tokens: req.maxTokens }),
        ...(req.tools?.length && {
            tools: req.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            })),
            tool_choice: 'auto',
        }),
    };
}
function parseResponsesOutput(output) {
    const items = Array.isArray(output)
        ? output
        : [];
    const toolCalls = [];
    const texts = [];
    for (const item of items) {
        if (item.type === 'function_call' &&
            typeof item.call_id === 'string' &&
            typeof item.name === 'string') {
            toolCalls.push({
                id: item.call_id,
                name: item.name,
                arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
            });
        }
        else if (item.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
                const text = part.type === 'refusal' ? part.refusal : part.text;
                if (typeof text === 'string' && text.trim())
                    texts.push(text.trim());
            }
        }
    }
    return { content: texts.length ? texts.join('\n') : null, toolCalls };
}
let OpenAiClient = OpenAiClient_1 = class OpenAiClient {
    config;
    usage;
    logger = new common_1.Logger(OpenAiClient_1.name);
    constructor(config, usage) {
        this.config = config;
        this.usage = usage;
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
        this.usage?.record(req.model, 'chat', data?.usage, Date.now() - started);
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
    async chatMessages(req) {
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
                body: JSON.stringify(agentBody(req)),
                signal: AbortSignal.timeout(req.timeoutMs),
            });
        }
        catch (err) {
            const reason = err instanceof Error ? err.name : 'error';
            this.logger.warn(`openai ${req.model} agent FAILED ${reason} ${Date.now() - started}ms`);
            throw new common_1.BadGatewayException('The AI service could not be reached');
        }
        const data = (await res.json().catch(() => null));
        this.logger.log(`openai ${req.model} agent ${res.status} ${Date.now() - started}ms`);
        this.usage?.record(req.model, 'chat', data?.usage, Date.now() - started);
        if (!res.ok) {
            throw new common_1.BadGatewayException(data?.error?.message ?? `The AI service answered ${res.status}`);
        }
        const message = data?.choices?.[0]?.message;
        const toolCalls = (message?.tool_calls ?? []).flatMap((c) => c.id && c.function?.name
            ? [
                {
                    id: c.id,
                    name: c.function.name,
                    arguments: c.function.arguments ?? '{}',
                },
            ]
            : []);
        const content = message?.content?.trim() || message?.refusal?.trim() || null;
        return { content, toolCalls };
    }
    async responsesAgent(req) {
        const key = this.config.get('OPENAI_API_KEY')?.trim();
        if (!key)
            throw new common_1.BadGatewayException('The AI service is not configured');
        const started = Date.now();
        let res;
        try {
            res = await fetch(RESPONSES_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(responsesBody(req)),
                signal: AbortSignal.timeout(req.timeoutMs),
            });
        }
        catch (err) {
            const reason = err instanceof Error ? err.name : 'error';
            this.logger.warn(`openai ${req.model} responses FAILED ${reason} ${Date.now() - started}ms`);
            throw new common_1.BadGatewayException('The AI service could not be reached');
        }
        const data = (await res.json().catch(() => null));
        this.logger.log(`openai ${req.model} responses ${res.status} ${Date.now() - started}ms`);
        this.usage?.record(req.model, 'responses', data?.usage, Date.now() - started);
        if (!res.ok) {
            throw new common_1.BadGatewayException(data?.error?.message ?? `The AI service answered ${res.status}`);
        }
        return parseResponsesOutput(data?.output);
    }
    async transcribe(audio, filename, mimeType, timeoutMs = 120_000) {
        const key = this.config.get('OPENAI_API_KEY')?.trim();
        if (!key)
            throw new common_1.BadGatewayException('The AI service is not configured');
        const model = this.config.get('OPENAI_TRANSCRIBE_MODEL')?.trim() ||
            'gpt-4o-mini-transcribe';
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
        form.append('model', model);
        form.append('response_format', 'json');
        const started = Date.now();
        let res;
        try {
            res = await fetch(TRANSCRIBE_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}` },
                body: form,
                signal: AbortSignal.timeout(timeoutMs),
            });
        }
        catch (err) {
            const reason = err instanceof Error ? err.name : 'error';
            this.logger.warn(`openai ${model} transcribe FAILED ${reason} ${Date.now() - started}ms`);
            throw new common_1.BadGatewayException('The AI service could not be reached');
        }
        const data = (await res.json().catch(() => null));
        this.logger.log(`openai ${model} transcribe ${res.status} ${Date.now() - started}ms`);
        this.usage?.record(model, 'transcribe', data?.usage, Date.now() - started, 'TRANSCRIBE');
        if (!res.ok) {
            throw new common_1.BadGatewayException(data?.error?.message ?? `The AI service answered ${res.status}`);
        }
        return (data?.text ?? '').trim();
    }
};
exports.OpenAiClient = OpenAiClient;
exports.OpenAiClient = OpenAiClient = OpenAiClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [config_1.ConfigService,
        ai_usage_service_1.AiUsageService])
], OpenAiClient);
//# sourceMappingURL=openai.client.js.map