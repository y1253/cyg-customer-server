import type { AiModel } from '@prisma/client';
import { type AiFeature, type AiUsageContext } from '../ai/ai-usage.context';
import { type ModelPrices, type UsageKind } from '../ai/usage.util';
import { PrismaService } from '../prisma/prisma.service';
export declare const LITELLM_PRICES_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
export declare const pricesOf: (m: AiModel) => ModelPrices;
export declare class AiUsageService {
    private readonly prisma;
    private readonly logger;
    private readonly models;
    private list;
    private refreshing;
    constructor(prisma: PrismaService);
    record(model: string, kind: UsageKind, usage: unknown, durationMs: number, feature?: AiFeature): void;
    recordFor(ctx: AiUsageContext, model: string, kind: UsageKind, usage: unknown, durationMs: number): void;
    private save;
    private model;
    private loadModel;
    private lookup;
    private priceList;
    refreshPrices(): Promise<{
        checked: number;
        changed: number;
        filled: number;
    }>;
    private fillMissingCosts;
}
