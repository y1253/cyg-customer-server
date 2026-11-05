import { BadRequestException } from '@nestjs/common';

/**
 * step8: multer limits for chat dictation (`POST /api/assistant/transcribe`) — a copy of
 * the internal app's `ai/transcribe-upload.ts`.
 *
 * 25 MB is OpenAI's own ceiling for a transcription; the browser stops a recording at
 * five minutes (`MAX_RECORDING_SEC`), far below it, so this is only the backstop.
 */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export function transcribeFileFilter(
  _req: unknown,
  file: { mimetype: string },
  cb: (err: Error | null, ok: boolean) => void,
): void {
  const base = (file.mimetype || '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.startsWith('audio/')) return cb(null, true);
  cb(
    new BadRequestException('That is not an audio recording.') as Error,
    false,
  );
}
