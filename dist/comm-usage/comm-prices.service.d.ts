import { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import { SignalWireClient } from '../messaging/signalwire.client';
import { PrismaService } from '../prisma/prisma.service';
import { CommUsageService } from './comm-usage.service';
export declare class CommPricesService implements OnApplicationBootstrap {
    private readonly prisma;
    private readonly config;
    private readonly signalwire;
    private readonly openai;
    private readonly usage;
    private readonly logger;
    private backfilling;
    private refreshing;
    constructor(prisma: PrismaService, config: ConfigService, signalwire: SignalWireClient, openai: OpenAiClient, usage: CommUsageService);
    onApplicationBootstrap(): void;
    backfillBilled(): Promise<number>;
    refreshPrices(): Promise<{
        checked: number;
        changed: number;
        priced: number;
    }>;
    private refreshOne;
    priceMissing(): Promise<number>;
}
