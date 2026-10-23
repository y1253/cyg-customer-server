import {
  OTHER_CHANNELS,
  linksOf,
  otherChannelsBlock,
  searchHit,
  type HistoryRow,
} from './history.util';

const NOW = new Date('2026-10-22T18:00:00Z');
const names = (id: number | null) =>
  id === 1 ? 'Company1' : `Biz ${id}`;

function row(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: 1,
    channel: 'VOICE',
    role: 'USER',
    text: 'Can you send me the lease and the September report?',
    createdAt: new Date('2026-10-22T15:12:00Z'),
    bookId: 1,
    actions: null,
    files: [],
    ...over,
  };
}

describe('otherChannelsBlock (step12b)', () => {
  it('lists the other channels oldest first, with who said it, files and what was done', () => {
    const block = otherChannelsBlock(
      [
        row({
          id: 2,
          role: 'ASSISTANT',
          text: 'Sure — I texted you the report.',
          createdAt: new Date('2026-10-22T15:13:00Z'),
          actions: [
            {
              tool: 'get_link',
              ok: true,
              summary: 'Shared a link to the financial report',
              ref: { type: 'report', from: '2026-09-01', to: '2026-09-30' },
            },
          ],
        }),
        row({
          id: 1,
          files: [{ attachmentId: 44, filename: 'lease.pdf', removed: false }],
        }),
      ],
      { now: NOW, currentBookId: 1, bookName: names },
    )!;
    const lines = block.split('\n').slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^\[Phone call · .* · customer\] Can you send me the lease/,
    );
    expect(lines[0]).toContain('(files: #44 "lease.pdf")');
    expect(lines[1]).toMatch(/· you\] Sure/);
    expect(lines[1]).toContain('[Done: Shared a link to the financial report]');
    expect(block).toContain('search_communications');
  });

  it('tags another book and drops what is too old', () => {
    const block = otherChannelsBlock(
      [
        row({ bookId: 7 }),
        row({
          id: 3,
          createdAt: new Date(
            NOW.getTime() - (OTHER_CHANNELS.hours + 1) * 3600_000,
          ),
        }),
      ],
      { now: NOW, currentBookId: 1, bookName: names },
    )!;
    expect(block.split('\n')).toHaveLength(2);
    expect(block).toContain('· Biz 7]');
  });

  it('keeps within the row and character limits, and is null when empty', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      row({
        id: i,
        text: 'x'.repeat(1000),
        createdAt: new Date(NOW.getTime() - i * 60_000),
      }),
    );
    const block = otherChannelsBlock(many, {
      now: NOW,
      currentBookId: 1,
      bookName: names,
    })!;
    const lines = block.split('\n').slice(1);
    expect(lines.length).toBeLessThanOrEqual(OTHER_CHANNELS.maxRows);
    expect(lines.join('\n').length).toBeLessThanOrEqual(
      OTHER_CHANNELS.maxChars,
    );
    expect(lines.every((l) => l.length < OTHER_CHANNELS.maxLine + 80)).toBe(
      true,
    );
    expect(
      otherChannelsBlock([], {
        now: NOW,
        currentBookId: 1,
        bookName: names,
      }),
    ).toBeNull();
  });
});

describe('searchHit / linksOf (step12b)', () => {
  it('returns the links the AI made so they can be made again', () => {
    const actions = [
      {
        tool: 'get_link',
        ok: true,
        summary: 'Shared a link to statement #9',
        ref: { type: 'statement', statementId: 9 },
      },
      {
        tool: 'get_link',
        ok: false,
        summary: 'Could not get link',
        ref: { type: 'report' },
      },
      { tool: 'attach_receipt', ok: true, summary: 'Attached a.jpg' },
    ];
    expect(linksOf(actions)).toEqual([{ type: 'statement', statementId: 9 }]);
    const hit = searchHit(
      row({ role: 'ASSISTANT', actions, bookId: 7 }),
      names,
    );
    expect(hit).toMatchObject({
      channel: 'Phone call',
      book: 'Biz 7',
      who: 'assistant',
      linksSent: [{ type: 'statement', statementId: 9 }],
      done: ['Shared a link to statement #9', 'Attached a.jpg'],
    });
    expect(linksOf('nonsense')).toEqual([]);
  });
});
