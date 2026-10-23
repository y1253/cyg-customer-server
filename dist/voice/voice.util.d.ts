import type { ToolDefinition } from '../ai/openai.client';
export declare const VOICES: readonly [{
    readonly id: "marin";
    readonly label: "Marin";
    readonly gender: "female";
}, {
    readonly id: "cedar";
    readonly label: "Cedar";
    readonly gender: "male";
}, {
    readonly id: "coral";
    readonly label: "Coral";
    readonly gender: "female";
}, {
    readonly id: "sage";
    readonly label: "Sage";
    readonly gender: "female";
}, {
    readonly id: "shimmer";
    readonly label: "Shimmer";
    readonly gender: "female";
}, {
    readonly id: "ash";
    readonly label: "Ash";
    readonly gender: "male";
}, {
    readonly id: "ballad";
    readonly label: "Ballad";
    readonly gender: "male";
}, {
    readonly id: "echo";
    readonly label: "Echo";
    readonly gender: "male";
}, {
    readonly id: "verse";
    readonly label: "Verse";
    readonly gender: "male";
}, {
    readonly id: "alloy";
    readonly label: "Alloy";
    readonly gender: "neutral";
}];
export declare const DEFAULT_VOICE = "marin";
export declare const isVoice: (v: unknown) => v is string;
export declare const LANGUAGES: Record<string, string>;
export declare const DEFAULT_LANGUAGE = "en";
export declare const isLanguage: (v: unknown) => v is string;
export declare const languageName: (id: string | null | undefined) => string;
export declare const VOICE_TOKEN_TYPE = "voice-call";
export type CallPurpose = 'INBOUND' | 'ACCOUNT_STATUS' | 'FINANCIAL_REPORT' | 'AI_SCHEDULE' | 'REQUESTED' | 'THIRD_PARTY';
export interface VoiceTokenClaims {
    typ: string;
    sub: number;
    peer: string;
    to?: string | null;
    dir: 'INBOUND' | 'OUTBOUND';
    purpose?: CallPurpose;
    bookId?: number | null;
    companyId?: number | null;
    runId?: number | null;
    script?: string | null;
    contactId?: number | null;
    contactName?: string | null;
}
export declare function realtimeTools(defs: readonly ToolDefinition[]): {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}[];
export declare function connectStreamLaml(url: string, params: Record<string, string>): string;
export declare function spokenScript(text: string): string;
export declare function callStatusOf(s: string | null | undefined): 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_ANSWER' | 'FAILED';
export declare class MuLawTrack {
    private chunks;
    private length;
    static readonly SILENCE = 255;
    get samples(): number;
    writeAt(at: number, chunk: Buffer): number;
    toBuffer(len: number): Buffer;
}
export declare function muLawStereoWav(left: Buffer, right: Buffer): Buffer;
export declare function signalWireSignatureValid(url: string, params: Record<string, unknown>, signature: string | null | undefined, key: string | null | undefined): boolean;
export declare const DEFAULT_REALTIME_MODEL = "gpt-realtime";
export declare const REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export declare function thirdPartyInstructions(input: {
    customerName: string;
    personName: string | null;
    message: string;
    language: string;
    maxMinutes: number;
}): string;
export declare function realtimeSession(input: {
    model: string;
    instructions: string;
    voice: string;
    tools: readonly ToolDefinition[];
}): {
    type: string;
    session: {
        type: string;
        model: string;
        instructions: string;
        output_modalities: string[];
        audio: {
            input: {
                format: {
                    type: string;
                };
                transcription: {
                    model: string;
                };
                turn_detection: {
                    type: string;
                    silence_duration_ms: number;
                    create_response: boolean;
                    interrupt_response: boolean;
                };
            };
            output: {
                format: {
                    type: string;
                };
                voice: string;
            };
        };
        tools: {
            type: "function";
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        }[];
        tool_choice: string;
    };
};
export declare const RT: {
    readonly audioDelta: readonly ["response.output_audio.delta", "response.audio.delta"];
    readonly assistantText: readonly ["response.output_audio_transcript.done", "response.audio_transcript.done"];
    readonly userText: readonly ["conversation.item.input_audio_transcription.completed"];
    readonly toolCall: readonly ["response.function_call_arguments.done"];
    readonly speechStarted: readonly ["input_audio_buffer.speech_started"];
    readonly responseCreated: readonly ["response.created"];
    readonly responseDone: readonly ["response.done"];
    readonly error: readonly ["error"];
};
