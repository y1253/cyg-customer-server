import {
  canonicalAccountName,
  isSameAccount,
  mergeGroups,
  sameAccountDigits,
} from './account-identity.util';

describe('sameAccountDigits', () => {
  it('matches a prefix or a suffix of at least 4 digits', () => {
    expect(sameAccountDigits('5234', '5234496')).toBe(true);
    expect(sameAccountDigits('4496', '5234496')).toBe(true);
    expect(sameAccountDigits('7308273', '7308273')).toBe(true);
  });
  it('refuses short or unrelated digits', () => {
    expect(sameAccountDigits('523', '5234496')).toBe(false);
    expect(sameAccountDigits('5234496', '5234871')).toBe(false);
    expect(sameAccountDigits('', '5234')).toBe(false);
  });
});

describe('isSameAccount', () => {
  it('needs the same bank text and the same kind', () => {
    const td = { name: 'TD Canada Trust 5234', kind: 'BANK' };
    expect(isSameAccount(td, { name: 'TD Canada Trust 5234496', kind: null })).toBe(true);
    expect(isSameAccount(td, { name: 'BMO 5234496', kind: 'BANK' })).toBe(false);
    // A card and a bank account with the same digits are two accounts.
    expect(
      isSameAccount(
        { name: 'BMO 2304', kind: 'BANK' },
        { name: 'BMO 2304', kind: 'CREDIT_CARD' },
      ),
    ).toBe(false);
  });
});

describe('canonicalAccountName', () => {
  const existing = [
    { name: 'TD Canada Trust 5234', kind: 'BANK' },
    { name: 'TD Canada Trust 7308', kind: 'BANK' },
  ];

  it('files a statement under the account it already belongs to', () => {
    expect(
      canonicalAccountName(
        { accountName: 'TD Canada Trust 5234496', accountNumber: '5234496', accountKind: 'BANK' },
        existing,
      ),
    ).toBe('TD Canada Trust 5234');
    expect(
      canonicalAccountName(
        { accountName: 'TD Canada Trust 7308273', accountKind: 'BANK' },
        existing,
      ),
    ).toBe('TD Canada Trust 7308');
  });

  it('keeps an exact existing name', () => {
    expect(
      canonicalAccountName({ accountName: 'TD Canada Trust 5234', accountKind: 'BANK' }, existing),
    ).toBe('TD Canada Trust 5234');
  });

  it('names a NEW account after the last 4 digits of its number', () => {
    expect(
      canonicalAccountName(
        { accountName: 'Desjardins 815300', accountNumber: '815300', accountKind: 'BANK' },
        existing,
      ),
    ).toBe('Desjardins 5300');
  });

  it('keeps its own name when it fits two accounts', () => {
    const two = [
      { name: 'TD Canada Trust 5234496', kind: 'BANK' },
      { name: 'TD Canada Trust 5234871', kind: 'BANK' },
    ];
    expect(
      canonicalAccountName({ accountName: 'TD Canada Trust 5234', accountKind: 'BANK' }, two),
    ).toBe('TD Canada Trust 5234');
  });

  it('passes a missing or digit-less name through', () => {
    expect(canonicalAccountName({ accountName: null, accountKind: 'BANK' }, existing)).toBeNull();
    expect(
      canonicalAccountName({ accountName: 'Owner chequing', accountKind: 'BANK' }, existing),
    ).toBe('Owner chequing');
  });
});

describe('mergeGroups', () => {
  it('merges the split names into the one used most', () => {
    expect(
      mergeGroups([
        { name: 'TD Canada Trust 5234', kind: 'BANK', statements: 3 },
        { name: 'TD Canada Trust 5234496', kind: 'BANK', statements: 9 },
        { name: 'TD Canada Trust 7308', kind: 'BANK', statements: 2 },
        { name: 'TD Canada Trust 7308273', kind: null, statements: 1 },
        { name: 'BMO 2304', kind: 'CREDIT_CARD', statements: 4 },
      ]),
    ).toEqual([
      { keep: 'TD Canada Trust 5234496', merge: ['TD Canada Trust 5234'] },
      { keep: 'TD Canada Trust 7308', merge: ['TD Canada Trust 7308273'] },
    ]);
  });

  it('leaves a short name that would chain two different accounts alone', () => {
    expect(
      mergeGroups([
        { name: 'TD 5234', kind: 'BANK', statements: 1 },
        { name: 'TD 5234496', kind: 'BANK', statements: 1 },
        { name: 'TD 5234871', kind: 'BANK', statements: 1 },
      ]),
    ).toEqual([]);
  });
});
