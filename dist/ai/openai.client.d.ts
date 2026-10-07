import { ConfigService } from '@nestjs/config';
export type ChatContent = string | Array<{
    type: 'text';
    text: string;
} | {
    type: 'file';
    file: {
        filename: string;
        file_data: string;
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
export declare class OpenAiClient {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    get configured(): boolean;
    chat(req: ChatRequest): Promise<string>;
}
