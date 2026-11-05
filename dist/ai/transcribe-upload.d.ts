export declare const MAX_TRANSCRIBE_BYTES: number;
export declare function transcribeFileFilter(_req: unknown, file: {
    mimetype: string;
}, cb: (err: Error | null, ok: boolean) => void): void;
