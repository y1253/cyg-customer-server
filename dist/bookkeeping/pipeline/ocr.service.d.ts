import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OcrResult } from './ocr.util';
export declare class OcrService implements OnModuleDestroy {
    private readonly config;
    private readonly logger;
    private engine;
    private queue;
    constructor(config: ConfigService);
    enabled(): boolean;
    read(image: Buffer, timeoutMs?: number): Promise<OcrResult | null>;
    onModuleDestroy(): Promise<void>;
    private readNow;
    private load;
    private create;
}
export declare function imageSize(image: Buffer): Promise<{
    width: number;
    height: number;
} | null>;
