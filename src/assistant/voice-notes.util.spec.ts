import { AttachmentKind, AttachmentStatus } from '@prisma/client';
import type { AttachmentView } from '../bookkeeping/attachments.service';
import { isVoiceMessage, spokenMessage } from './voice-notes.util';

function file(
  id: number,
  kind: AttachmentKind,
  status: AttachmentStatus,
  transcript?: string,
): AttachmentView {
  return {
    id,
    kind,
    status,
    reading: transcript === undefined ? null : { transcript },
  } as unknown as AttachmentView;
}

describe('spokenMessage', () => {
  it('a question voice note is the message, not a file', () => {
    const r = spokenMessage(null, [
      file(1, 'AUDIO', 'DOCUMENT', ' can you send me my January report '),
    ]);
    expect(r.words).toBe('can you send me my January report');
    expect(r.files).toEqual([]);
    expect(r.voiceOnly).toEqual([1]);
  });

  it('a payment voice note stays a file and its words are answered too', () => {
    const note = file(2, 'AUDIO', 'MATCHED', 'paid Home Depot 45 dollars');
    const r = spokenMessage(null, [note]);
    expect(r.words).toBe('paid Home Depot 45 dollars');
    expect(r.files).toEqual([note]);
    expect(r.voiceOnly).toEqual([]);
  });

  it('typed words come first, then each voice note, labelled', () => {
    const photo = file(3, 'RECEIPT', 'MATCHED');
    const r = spokenMessage('here you go', [
      photo,
      file(4, 'AUDIO', 'DOCUMENT', 'is this for March?'),
    ]);
    expect(r.words).toBe('here you go\n\n(voice note) is this for March?');
    expect(r.files).toEqual([photo]);
  });

  it('sibling rows of one note give its words once', () => {
    const r = spokenMessage(null, [
      file(6, 'AUDIO', 'MATCHED', 'Costco 20 and Shell 40'),
      file(7, 'AUDIO', 'UNMATCHED', 'Costco 20 and Shell 40'),
    ]);
    expect(r.words).toBe('Costco 20 and Shell 40');
    expect(r.files.map((f) => f.id)).toEqual([6, 7]);
  });

  it('a recording that could not be heard stays a file', () => {
    const failed = file(5, 'AUDIO', 'FAILED');
    const r = spokenMessage(null, [failed]);
    expect(r.words).toBe('');
    expect(r.files).toEqual([failed]);
  });

  it('isVoiceMessage = AUDIO read as a DOCUMENT only', () => {
    expect(isVoiceMessage({ kind: 'AUDIO', status: 'DOCUMENT' })).toBe(true);
    expect(isVoiceMessage({ kind: 'AUDIO', status: 'UNMATCHED' })).toBe(false);
    expect(isVoiceMessage({ kind: 'OTHER', status: 'DOCUMENT' })).toBe(false);
  });
});
