import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { BookScope } from '../bookkeeping/scope';
import { VoiceCallsService } from './voice-calls.service';
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
}
