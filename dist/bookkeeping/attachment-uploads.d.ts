import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MAX_FILES_PER_REQUEST } from './statement-uploads';
export declare const MAX_ATTACHMENT_BYTES: number;
export { MAX_FILES_PER_REQUEST };
export type AttachmentClass = 'pdf' | 'image' | 'audio' | 'text';
export declare function attachmentType(filename: string): {
    cls: AttachmentClass;
    mime: string;
    ext: string;
} | null;
export declare const ATTACHMENT_UPLOAD_OPTIONS: MulterOptions;
