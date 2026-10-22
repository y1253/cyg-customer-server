import type { AttachmentView } from '../bookkeeping/attachments.service';
export interface SpokenMessage {
    words: string;
    files: AttachmentView[];
    voiceOnly: number[];
}
export declare function isVoiceMessage(a: Pick<AttachmentView, 'kind' | 'status'>): boolean;
export declare function spokenMessage(text: string | null, files: AttachmentView[]): SpokenMessage;
