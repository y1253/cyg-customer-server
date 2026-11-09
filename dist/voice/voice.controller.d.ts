import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { BookScope } from '../bookkeeping/scope';
import { VoiceCallsService, type TranscriptLine } from './voice-calls.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
export declare class CallMeDto {
    statementId?: number;
    attachmentId?: number;
}
export declare class VoiceStatusController {
    private readonly calls;
    private readonly config;
    constructor(calls: VoiceCallsService, config: ConfigService);
    status(req: Request, body: Record<string, unknown>): Promise<void>;
}
export declare class VoiceRecordingController {
    private readonly calls;
    constructor(calls: VoiceCallsService);
    recording(scope: BookScope, id: number, res: Response): Promise<StreamableFile>;
    transcript(scope: BookScope, id: number): Promise<{
        lines: TranscriptLine[];
    }>;
}
export declare class CallMeController {
    private readonly calls;
    constructor(calls: VoiceCallsService);
    available(scope: BookScope): Promise<{
        available: boolean;
    }>;
    callMe(scope: BookScope, dto: CallMeDto): Promise<{
        ok: boolean;
        message: string;
    }>;
}
export declare function welcomeText(name: string, whatsapp: boolean, voice: boolean): string;
export declare class WelcomeTextController {
    private readonly prisma;
    private readonly messenger;
    private readonly config;
    private readonly lastSent;
    constructor(prisma: PrismaService, messenger: CustomerMessenger, config: ConfigService);
    send(scope: BookScope): Promise<{
        ok: boolean;
        message: string;
    }>;
}
