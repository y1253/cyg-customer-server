import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
export declare const MAX_STATEMENT_BYTES: number;
export declare const MAX_FILES_PER_REQUEST = 20;
export declare const STATEMENT_UPLOAD_OPTIONS: MulterOptions;
export declare function sweepStaleStaging(maxAgeMs: number): Promise<number>;
