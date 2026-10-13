import {
  obviousMatch,
  shortlist,
  type MatchCandidate,
} from './attachment-match.util';

const row = (
  id: number,
  amount: number,
  date: string | null,
  attachedTotals: number[] = [],
): MatchCandidate => ({
  id,
  amount,
  date,
  name: null,
  description: `row ${id}`,
  attachedTotals,
});

describe('matching an attachment to a transaction', () => {
  const rows = [
    row(1, -100, '2026-09-03'),
    row(2, -100, '2026-10-30'), // too late
    row(3, 100, '2026-09-03'), // money in
    row(4, -115, '2026-09-04'), // a tip
    row(5, -130, '2026-09-04'), // more than 20% over
    row(6, -99.99, '2026-09-03'), // less than the receipt
  ];

  it('keeps money out, the exact amount or a tip, inside the date window', () => {
    const list = shortlist(
      { kind: 'RECEIPT', date: '2026-09-02', total: 100 },
      rows,
    );
    expect(list.map((r) => r.id)).toEqual([1, 4]);
  });

  it('a check may be money in', () => {
    const list = shortlist(
      { kind: 'CHECK', date: '2026-09-02', total: 100 },
      rows,
    );
    expect(list.map((r) => r.id)).toEqual([1, 3, 4]);
  });

  it('no date on the attachment = any date', () => {
    const list = shortlist({ kind: 'RECEIPT', date: null, total: 100 }, rows);
    expect(list.map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it('ranks a row that already holds this receipt total last', () => {
    const list = shortlist(
      { kind: 'RECEIPT', date: '2026-09-03', total: 100 },
      [row(1, -100, '2026-09-03', [10000]), row(2, -100, '2026-09-05')],
    );
    expect(list.map((r) => r.id)).toEqual([2, 1]);
  });

  it('one exact hit close in date needs no AI', () => {
    const q = { kind: 'RECEIPT' as const, date: '2026-09-02', total: 100 };
    expect(obviousMatch(q, shortlist(q, rows))?.id).toBe(1);
  });

  it('two exact hits, or a far date, go to the AI', () => {
    const q = { kind: 'RECEIPT' as const, date: null, total: 100 };
    expect(obviousMatch(q, shortlist(q, rows))).toBeNull();
    const far = { kind: 'RECEIPT' as const, date: '2026-08-25', total: 100 };
    expect(obviousMatch(far, [row(1, -100, '2026-09-03')])).toBeNull();
    expect(
      obviousMatch({ ...far, total: null }, [row(1, -100, null)]),
    ).toBeNull();
  });
});
