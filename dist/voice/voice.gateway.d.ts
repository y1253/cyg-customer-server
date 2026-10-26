import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'http';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AssistantTools } from '../assistant/assistant-tools';
import { AssistantService } from '../assistant/assistant.service';
import { SignalWireClient } from '../messaging/signalwire.client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { VoiceCallsService } from './voice-calls.service';
export declare const VOICE_WS_PATH = "/api/voice/stream";
export declare class VoiceGateway implements OnModuleDestroy {
    private readonly prisma;
    private readonly config;
    private readonly calls;
    private readonly assistant;
    private readonly tools;
    private readonly signalwire;
    private readonly usage;
    private readonly sales;
    private readonly logger;
    private readonly wss;
    constructor(prisma: PrismaService, config: ConfigService, calls: VoiceCallsService, assistant: AssistantService, tools: AssistantTools, signalwire: SignalWireClient, usage: AiUsageService, sales: SalesService);
    attach(server: Server): void;
    onModuleDestroy(): void;
}
