import { AttachmentKind, AttachmentStatus } from '@prisma/client';
import type { AttachmentView } from '../bookkeeping/attachments.service';

/**
 * step12: a voice note is the customer TALKING to the assistant (the WhatsApp voice note
 * that asked for a report got "I couldn't find where to attach it": the model was handed
 * "[sent a file]" as the message and the words as file data).
 *
 * So after the files are read: every voice note's transcript becomes part of what the
 * customer said, and a voice note with no payment in it (read as a DOCUMENT) is not a file
 * at all — it leaves the file list. A voice note about a payment stays a file (it was
 * filed / matched like a receipt) and its words are answered too. One that could not be
 * heard (no transcript) stays a file, so the answer can say so.
 */
export interface SpokenMessage {
  /** The customer's whole message: what they typed, then each voice note's words. */
  words: string;
  /** The files left to talk about. */
  files: AttachmentView[];
  /** Ids of the voice notes that were only a message (none = no voice note). */
  voiceOnly: number[];
}

/** A voice note that is just a message — `kind AUDIO` read as a DOCUMENT (no payment). */
export function isVoiceMessage(a: Pick<AttachmentView, 'kind' | 'status'>) {
  return (
    a.kind === AttachmentKind.AUDIO && a.status === AttachmentStatus.DOCUMENT
  );
}

export function spokenMessage(
  text: string | null,
  files: AttachmentView[],
): SpokenMessage {
  const parts: string[] = [];
  const typed = text?.trim();
  if (typed) parts.push(typed);
  const kept: AttachmentView[] = [];
  const voiceOnly: number[] = [];
  // A note naming several purchases is read into sibling rows that share its transcript.
  const heard = [
    ...new Set(
      files
        .filter((f) => f.kind === AttachmentKind.AUDIO)
        .map((f) => f.reading?.transcript?.trim() ?? '')
        .filter(Boolean),
    ),
  ];
  const label = heard.length > 1 || !!typed;
  for (const said of heard) parts.push(label ? `(voice note) ${said}` : said);
  for (const f of files) {
    const said =
      f.kind === AttachmentKind.AUDIO ? f.reading?.transcript?.trim() : '';
    if (said && isVoiceMessage(f)) voiceOnly.push(f.id);
    else kept.push(f);
  }
  return { words: parts.join('\n\n'), files: kept, voiceOnly };
}
