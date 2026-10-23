import { ConfigService } from '@nestjs/config';
export interface SwRecording {
    sid: string;
    callSid: string | null;
    durationSec: number | null;
    status: string;
}
export interface SwCallInfo {
    sid: string;
    status: string;
    durationSec: number | null;
}
export declare class SignalWireClient {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    private env;
    get configured(): boolean;
    private base;
    private auth;
    private request;
    createCall(input: {
        to: string;
        from: string;
        laml: string;
        statusCallback?: string | null;
        record?: boolean;
        timeoutSec?: number;
    }): Promise<string>;
    startRecording(callSid: string): Promise<string | null>;
    getCall(callSid: string): Promise<SwCallInfo | null>;
    billed(kind: 'Messages' | 'Calls', sid: string): Promise<{
        price: unknown;
        segments: number | null;
        durationSec: number | null;
        status: string | null;
    } | null>;
    listRecordings(callSid: string): Promise<SwRecording[]>;
    fetchRecording(sid: string): Promise<Buffer>;
    hangup(callSid: string): Promise<void>;
}
