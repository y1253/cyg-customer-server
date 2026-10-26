import {
  buildTimeline,
  idsOf,
  pageOf,
  previewOf,
  type AttachmentIn,
} from './communications.util';

const at = (iso: string) => new Date(iso);
const file = (
  id: number,
  createdAt: string,
  message: string | null = null,
): AttachmentIn => ({
  id,
  filename: `r${id}.jpg`,
  mimeType: 'image/jpeg',
  status: 'MATCHED',
  message,
  createdAt: at(createdAt),
});

describe('buildTimeline', () => {
  it('puts messages and loose files in one list, newest first', () => {
    const items = buildTimeline({
      messages: [
        {
          id: 1,
          role: 'USER',
          text: 'hi',
          warning: null,
          attachmentIds: null,
          createdAt: at('2026-10-01T10:00:00Z'),
        },
        {
          id: 2,
          role: 'ASSISTANT',
          text: 'Hello!',
          warning: null,
          attachmentIds: null,
          createdAt: at('2026-10-01T10:00:05Z'),
        },
      ],
      files: new Map(),
      loose: [file(7, '2026-10-02T09:00:00Z', 'gas')],
      statements: [
        {
          id: 3,
          filename: 'sep.pdf',
          status: 'DONE',
          createdAt: at('2026-09-30T12:00:00Z'),
        },
      ],
    });
    expect(items.map((i) => i.key)).toEqual(['a:7', 'm:2', 'm:1', 's:3']);
    expect(items[0]).toMatchObject({
      side: 'customer',
      kind: 'upload',
      text: 'gas',
    });
    expect(items[1].side).toBe('cyg');
    expect(items[3].files[0]).toMatchObject({
      type: 'statement',
      filename: 'sep.pdf',
    });
  });

  it('shows the files a message carried, and hides the "[sent a file]" placeholder', () => {
    const [m] = buildTimeline({
      messages: [
        {
          id: 1,
          role: 'USER',
          text: '[sent 2 files]',
          warning: null,
          attachmentIds: [5, 6, 99],
          createdAt: at('2026-10-01T10:00:00Z'),
        },
      ],
      files: new Map([
        [5, file(5, '2026-10-01T10:00:00Z')],
        [6, file(6, '2026-10-01T10:00:00Z')],
      ]),
      loose: [],
      statements: [],
    });
    expect(m.text).toBeNull();
    expect(m.files.map((f) => f.id)).toEqual([5, 6]);
  });

  it('keeps the words when a placeholder-looking message has no files left', () => {
    const [m] = buildTimeline({
      messages: [
        {
          id: 1,
          role: 'USER',
          text: '[sent a file]',
          warning: null,
          attachmentIds: [5],
          createdAt: at('2026-10-01T10:00:00Z'),
        },
      ],
      files: new Map(),
      loose: [],
      statements: [],
    });
    expect(m.text).toBe('[sent a file]');
  });
});

describe('pageOf', () => {
  it('cuts the page and says where the next one starts', () => {
    const items = buildTimeline({
      messages: [],
      files: new Map(),
      loose: [
        file(1, '2026-10-03T00:00:00Z'),
        file(2, '2026-10-02T00:00:00Z'),
        file(3, '2026-10-01T00:00:00Z'),
      ],
      statements: [],
    });
    expect(pageOf(items, 2)).toEqual({
      items: items.slice(0, 2),
      nextBefore: '2026-10-02T00:00:00.000Z',
    });
    expect(pageOf(items, 3).nextBefore).toBeNull();
  });
});

describe('previewOf / idsOf', () => {
  it('previews text, else the file name', () => {
    const [f] = buildTimeline({
      messages: [],
      files: new Map(),
      loose: [file(1, '2026-10-01T00:00:00Z')],
      statements: [],
    });
    expect(previewOf(f)).toBe('📎 r1.jpg');
    expect(previewOf(undefined)).toBeNull();
  });

  it('reads only positive integer ids', () => {
    expect(idsOf([1, '2', -3, 4.5, 6])).toEqual([1, 6]);
    expect(idsOf(null)).toEqual([]);
  });
});

describe('pageOf with a cutoff (step12g)', () => {
  const item = (at: string) => ({
    key: at,
    at,
    side: 'customer' as const,
    kind: 'message' as const,
    text: null,
    files: [],
  });

  it('stops at the cutoff and continues from it', () => {
    const items = [
      '2026-10-26T10:00:00.000Z',
      '2026-10-26T09:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
    ].map(item);
    expect(pageOf(items, 50, '2026-10-26T09:00:00.000Z')).toEqual({
      items: items.slice(0, 2),
      nextBefore: '2026-10-26T09:00:00.000Z',
    });
  });

  it('a full page still cuts at the limit', () => {
    const items = ['2026-10-26T10:00:00.000Z', '2026-10-26T09:00:00.000Z'].map(
      item,
    );
    expect(pageOf(items, 1, '2026-10-26T08:00:00.000Z')).toEqual({
      items: items.slice(0, 1),
      nextBefore: '2026-10-26T10:00:00.000Z',
    });
  });
});
