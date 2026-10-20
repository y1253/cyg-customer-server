import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
export declare class ProductCategorizer {
    private readonly openai;
    private readonly config;
    constructor(openai: OpenAiClient, config: ConfigService);
    get configured(): boolean;
    private model;
    categorize(items: ReadonlyArray<{
        key: string;
        name: string;
    }>, context?: {
        store?: string | null;
        category?: string | null;
        rules?: string;
    }): Promise<Map<string, string>>;
}
