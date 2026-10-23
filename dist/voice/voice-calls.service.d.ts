import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiCall, AiConversation } from '@prisma/client';
import { CommUsageService } from '../comm-usage/comm-usage.service';
import { Subject } from 'rxjs';
import { AssistantTools, type PersonTarget, type ToolContext } from '../assistant/assistant-tools';
import { CustomerOutbox } from '../assistant/customer-outbox.service';
import { type BookScope } from '../bookkeeping/scope';
import { SignalWireClient } from '../messaging/signalwire.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { type CallPurpose, type VoiceTokenClaims } from './voice.util';
export interface VoiceSettings {
    enabled: boolean;
    voice: string;
    greeting: string | null;
    maxMinutes: number;
    language: string;
}
export interface OutboundMissed {
    runId: number | null;
    aiRunId: number | null;
    status: string;
}
export interface CallView {
    id: number;
    direction: string;
    purpose: string;
    status: string;
    startedAt: string;
    answeredAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
    hasRecording: boolean;
    fromNumber: string | null;
    toNumber: string | null;
    withName: string;
    contactName: string | null;
}
export declare class VoiceCallsService implements OnModuleInit {
    private readonly prisma;
    private readonly config;
    private readonly signalwire;
    private readonly storage;
    private readonly tools?;
    private readonly outbox?;
    private readonly usage?;
    private readonly logger;
    private readonly jwt;
    readonly outboundMissed$: Subject<OutboundMissed>;
    private readonly personCalls;
    constructor(prisma: PrismaService, config: ConfigService, signalwire: SignalWireClient, storage: ObjectStorageService, tools?: AssistantTools | undefined, outbox?: CustomerOutbox | undefined, usage?: CommUsageService | undefined);
    onModuleInit(): void;
    callMeNow(ctx: ToolContext, about: string): Promise<{
        ok: true;
        summary: string;
    } | {
        ok: false;
        error: string;
    }>;
    callPersonNow(ctx: ToolContext, person: PersonTarget, message: string): Promise<{
        ok: true;
        summary: string;
    } | {
        ok: false;
        error: string;
    }>;
    private reportPersonCall;
    private reportToCustomer;
    overCallLimit(customerId: number): Promise<boolean>;
    settings(): Promise<VoiceSettings>;
    canCall(): Promise<boolean>;
    private base;
    streamUrl(): string;
    statusUrl(): string;
    sign(claims: Omit<VoiceTokenClaims, 'typ'>, ttlSeconds?: number): string;
    verify(token: string | null | undefined): VoiceTokenClaims | null;
    conversationFor(claims: VoiceTokenClaims): Promise<AiConversation>;
    started(claims: VoiceTokenClaims, conversation: AiConversation, callSid: string): Promise<AiCall>;
    private recordStart;
    ended(callSid: string, extra: {
        recordingSid?: string | null;
        wav?: Buffer | null;
        error?: string | null;
    }): Promise<void>;
    callCustomer(input: {
        scope: BookScope;
        peer: string;
        purpose: CallPurpose;
        runId?: number | null;
        aiScheduleRunId?: number | null;
        script: string;
        contactId?: number | null;
        contactName?: string | null;
    }): Promise<{
        callSid: string;
    } | {
        error: string;
    }>;
    onStatus(callSid: string, rawStatus: string, durationSec: number | null): Promise<void>;
    callsFor(scope: BookScope, before: Date | null, take: number): Promise<CallView[]>;
    recording(scope: BookScope, id: number): Promise<{
        body: Buffer;
        contentType: string;
        filename: string;
    }>;
}
export declare function toCallView(c: AiCall & {
    contact?: {
        name: string;
    } | null;
    customer?: {
        name: string;
    } | null;
}): CallView;
