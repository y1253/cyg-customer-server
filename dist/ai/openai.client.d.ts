import { ConfigService } from '@nestjs/config';
import { AiUsageService } from '../ai-usage/ai-usage.service';
export type ChatContent = string | Array<{
    type: 'text';
    text: string;
} | {
    type: 'file';
    file: {
        filename: string;
        file_data: string;
    };
} | {
    type: 'image_url';
    image_url: {
        url: string;
    };
}>;
export interface ChatRequest {
    model: string;
    system: string;
    user: ChatContent;
    jsonSchema?: {
        name: string;
        schema: Record<string, unknown>;
    };
    temperature?: number;
    maxTokens?: number;
    timeoutMs: number;
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}
export type AgentMessage = {
    role: 'system';
    content: string;
} | {
    role: 'user';
    content: string;
} | {
    role: 'assistant';
    content: string | null;
    toolCalls?: ToolCall[];
} | {
    role: 'tool';
    toolCallId: string;
    content: string;
};
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export interface AgentRequest {
    model: string;
    messages: AgentMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    timeoutMs: number;
}
export interface AgentReply {
    content: string | null;
    toolCalls: ToolCall[];
}
export declare function agentBody(req: AgentRequest): Record<string, unknown>;
export declare function responsesBody(req: AgentRequest): Record<string, unknown>;
export declare function parseResponsesOutput(output: unknown): AgentReply;
export declare class OpenAiClient {
    private readonly config;
    private readonly usage?;
    private readonly logger;
    constructor(config: ConfigService, usage?: AiUsageService | undefined);
    get configured(): boolean;
    chat(req: ChatRequest): Promise<string>;
    chatMessages(req: AgentRequest): Promise<AgentReply>;
    responsesAgent(req: AgentRequest): Promise<AgentReply>;
    transcribe(audio: Buffer, filename: string, mimeType: string, timeoutMs?: number): Promise<string>;
}
