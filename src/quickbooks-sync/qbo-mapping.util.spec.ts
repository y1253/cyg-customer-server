import {
  familyHash,
  familyLines,
  qboBody,
  qboCategoryName,
  qboQuote,
  qboText,
  qboTypeOf,
  type QboFamily,
} from './qbo-mapping.util';

const family = (over: Partial<QboFamily> = {}): QboFamily => ({
  rowId: 1,
  externalId: 'tx1',
  date: '2026-11-20',
  cents: -10000,
  name: 'Walmart',
  description: 'POS WALMART #12',
  kind: 'BANK',
  plaidAccountId: 7,
  lines: [{ category: 'Office Expense', cents: 10000, description: null }],
  ...over,
});

describe('familyLines', () => {
  it('keeps the remainder in the parent category, then each split', () => {
    expect(
      familyLines({ amount: -100, category: 'Office Expense', description: null }, [
        { amount: -30, category: 'Meals', description: 'Walmart - Meals' },
      ]),
    ).toEqual([
      { category: 'Office Expense', cents: 7000, description: null },
      { category: 'Meals', cents: 3000, description: 'Walmart - Meals' },
    ]);
  });

  it('drops a remainder of zero and zero splits', () => {
    expect(
      familyLines({ amount: 50, category: 'Sales Income', description: null }, [
        { amount: 50, category: 'Service Income', description: null },
        { amount: 0, category: 'Meals', description: null },
      ]),
    ).toEqual([{ category: 'Service Income', cents: 5000, description: null }]);
  });
});

describe('qboTypeOf', () => {
  it('money out is a Purchase, money in a Deposit — a card credit stays a Purchase', () => {
    expect(qboTypeOf({ cents: -1, kind: 'BANK' })).toBe('Purchase');
    expect(qboTypeOf({ cents: 1, kind: 'BANK' })).toBe('Deposit');
    expect(qboTypeOf({ cents: 1, kind: 'CREDIT_CARD' })).toBe('Purchase');
  });
});

describe('names and quoting', () => {
  it('maps Uncategorized to QuickBooks own accounts by direction', () => {
    expect(qboCategoryName('Uncategorized', true)).toBe('Uncategorized Expense');
    expect(qboCategoryName('Uncategorized', false)).toBe('Uncategorized Income');
  });

  it('strips the sub-account colon and caps the length', () => {
    expect(qboText('A: B\tC')).toBe('A B C');
    expect(qboText('x'.repeat(150))).toHaveLength(100);
  });

  it('escapes quotes in a query literal', () => {
    expect(qboQuote("Owner's Loan")).toBe("'Owner\\'s Loan'");
  });
});

describe('familyHash', () => {
  it('changes when a category changes, not otherwise', () => {
    const a = family();
    expect(familyHash(a)).toBe(familyHash(family()));
    expect(familyHash(a)).not.toBe(
      familyHash(
        family({ lines: [{ category: 'Meals', cents: 10000, description: null }] }),
      ),
    );
  });
});

describe('qboBody', () => {
  const accountIds = new Map([
    ['Office Expense', '50'],
    ['Sales Income', '60'],
  ]);

  it('builds a Purchase with the vendor and the category account', () => {
    const body = qboBody(family(), {
      bankAccountId: '35',
      entity: { id: '9', type: 'Vendor' },
      accountIds,
    });
    expect(body).toMatchObject({
      PaymentType: 'Cash',
      AccountRef: { value: '35' },
      EntityRef: { value: '9', type: 'Vendor' },
      Line: [
        {
          Amount: 100,
          AccountBasedExpenseLineDetail: { AccountRef: { value: '50' } },
        },
      ],
    });
    expect(body).not.toHaveProperty('Credit');
  });

  it('builds a Deposit for money into a bank account', () => {
    const body = qboBody(
      family({
        cents: 2550,
        lines: [{ category: 'Sales Income', cents: 2550, description: null }],
      }),
      { bankAccountId: '35', entity: null, accountIds },
    );
    expect(body).toMatchObject({
      DepositToAccountRef: { value: '35' },
      Line: [
        { Amount: 25.5, DepositLineDetail: { AccountRef: { value: '60' } } },
      ],
    });
  });

  it('a card refund is a credit Purchase', () => {
    const body = qboBody(family({ cents: 10000, kind: 'CREDIT_CARD' }), {
      bankAccountId: '40',
      entity: null,
      accountIds,
    });
    expect(body).toMatchObject({ PaymentType: 'CreditCard', Credit: true });
  });
});
