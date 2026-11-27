import {
  acceptMatch,
  candidatesFor,
  lastDigits,
  nameScore,
  verifyMatch,
  type OurBankAccount,
} from './qbo-bank-match.util';

const td: OurBankAccount = {
  accountName: 'TD 4562',
  mask: '4562',
  institution: 'TD Canada Trust',
  kind: 'BANK',
};

describe('qbo-bank-match (step11 part 3)', () => {
  it('reads the last 4 digits from the mask, else the folder name', () => {
    expect(lastDigits(td)).toBe('4562');
    expect(lastDigits({ ...td, mask: null, accountName: 'Chase 0361' })).toBe(
      '0361',
    );
    expect(lastDigits({ ...td, mask: null, accountName: 'Wise' })).toBeNull();
  });

  it('scores the name: same kind only, then name, digits, bank words', () => {
    expect(
      nameScore(td, { id: '1', name: 'TD 4562', acctNum: null, type: 'Bank' }),
    ).toBe(17);
    expect(
      nameScore(td, {
        id: '2',
        name: 'TD Chequing',
        acctNum: '00451234562',
        type: 'Bank',
      }),
    ).toBe(7);
    expect(
      nameScore(td, { id: '3', name: 'Checking', acctNum: null, type: 'Bank' }),
    ).toBe(0);
    expect(
      nameScore(td, {
        id: '4',
        name: 'TD 4562',
        acctNum: null,
        type: 'Credit Card',
      }),
    ).toBe(-1);
  });

  it('lists candidates best first, never another kind', () => {
    const list = candidatesFor(td, [
      { id: '3', name: 'Checking', acctNum: null, type: 'Bank' },
      { id: '4', name: 'TD Visa', acctNum: null, type: 'Credit Card' },
      { id: '2', name: 'TD Chequing 4562', acctNum: null, type: 'Bank' },
    ]);
    expect(list.map((c) => c.account.id)).toEqual(['2', '3']);
  });

  it('matches rows by cents and sign within 3 days, each once', () => {
    const v = verifyMatch(
      [
        { date: '2026-11-01', cents: -1000 },
        { date: '2026-11-02', cents: -1000 },
        { date: '2026-11-10', cents: 5000 },
        { date: '2026-11-20', cents: -999 },
      ],
      [
        { date: '2026-11-03', cents: -1000 },
        { date: '2026-11-12', cents: 5000 },
        { date: '2026-11-20', cents: 999 },
      ],
    );
    expect(v).toEqual({ matched: 2, compared: 4 });
  });

  it('accepts only with proof', () => {
    expect(acceptMatch(7, { matched: 3, compared: 5 }, 10)).toBe(true);
    expect(acceptMatch(7, { matched: 2, compared: 2 }, 10)).toBe(false);
    expect(acceptMatch(0, { matched: 4, compared: 5 }, 10)).toBe(false);
    expect(acceptMatch(0, { matched: 7, compared: 9 }, 10)).toBe(true);
    // Nothing to compare: only the same name.
    expect(acceptMatch(17, { matched: 0, compared: 0 }, 0)).toBe(true);
    expect(acceptMatch(7, { matched: 0, compared: 0 }, 0)).toBe(false);
    expect(acceptMatch(-1, { matched: 9, compared: 9 }, 9)).toBe(false);
  });
});
