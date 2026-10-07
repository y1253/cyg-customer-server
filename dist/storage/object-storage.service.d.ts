import type { Readable } from 'stream';
export declare class ObjectStorageService {
    private readonly logger;
    private client;
    private readonly bucket;
    constructor();
    get configured(): boolean;
    private s3;
    assertKey(key: string): void;
    putFile(key: string, absolutePath: string, contentType?: string): Promise<void>;
    head(key: string): Promise<{
        size: number;
    } | null>;
    getStream(key: string): Promise<Readable>;
    getBuffer(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
}
