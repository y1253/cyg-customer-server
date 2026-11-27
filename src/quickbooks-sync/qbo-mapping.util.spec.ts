import {
  familyHash,
  familyLines,
  qboBody,
  qboCategoryName,
  qboPayeeName,
  qboQuote,
  qboText,
  qboTypeOf,
  repointEntity,
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
      familyLines(
        { amount: -100, category: 'Office Expense', description: null },
        [{ amount: -30, category: 'Meals', description: 'Walmart - Meals' }],
      ),
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
    expect(qboCategoryName('Uncategorized', true)).toBe(
      'Uncategorized Expense',
    );
    expect(qboCategoryName('Uncategorized', false)).toBe(
      'Uncategorized Income',
    );
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
        family({
          lines: [{ category: 'Meals', cents: 10000, description: null }],
        }),
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

describe('qboPayeeName', () => {
  it('keeps a plain name as QuickBooks accepts it', () => {
    expect(qboPayeeName('Walmart: Store', false)).toBe('Walmart Store');
  });
  it('adds -mix to a name of several categories, within 100 characters', () => {
    expect(qboPayeeName('Walmart', true)).toBe('Walmart-mix');
    const long = qboPayeeName('x'.repeat(120), true);
    expect(long).toHaveLength(100);
    expect(long.endsWith('-mix')).toBe(true);
  });
});

describe('repointEntity (step11 part 2: a name merge moves the payee)', () => {
  const to = { id: '9', type: 'Vendor' };

  it('moves a Purchase of the old payee, keeping its SyncToken', () => {
    expect(
      repointEntity(
        'Purchase',
        { Id: '1', SyncToken: '3', EntityRef: { value: '5', name: 'Old' } },
        '5',
        to,
      ),
    ).toEqual({ SyncToken: '3', EntityRef: { value: '9', type: 'Vendor' } });
  });

  it('leaves another payee’s Purchase alone', () => {
    expect(
      repointEntity('Purchase', { EntityRef: { value: '6' } }, '5', to),
    ).toBeNull();
    expect(repointEntity('Purchase', {}, '5', to)).toBeNull();
  });

  it('a Deposit sends every line back, only the old payee’s changed', () => {
    const other = {
      Amount: 2,
      DepositLineDetail: { Entity: { value: '7', type: 'Customer' } },
    };
    const body = repointEntity(
      'Deposit',
      {
        SyncToken: '0',
        Line: [
          {
            Amount: 1,
            DepositLineDetail: {
              AccountRef: { value: '40' },
              Entity: { value: '5', type: 'Customer' },
            },
          },
          other,
        ],
      },
      '5',
      to,
    );
    expect(body).toEqual({
      SyncToken: '0',
      Line: [
        {
          Amount: 1,
          DepositLineDetail: {
            AccountRef: { value: '40' },
            Entity: { value: '9', type: 'Vendor' },
          },
        },
        other,
      ],
    });
    expect(repointEntity('Deposit', { Line: [other] }, '5', to)).toBeNull();
  });
});

describe('classes and custom fields (step11 part 3)', () => {
  const accountIds = new Map([
    ['Office Expense', '50'],
    ['Sales Income', '60'],
  ]);
  const classIds = new Map([['Montreal', '700']]);

  it('a split takes its own class, else its transaction’s', () => {
    expect(
      familyLines(
        {
          amount: -100,
          category: 'Office Expense',
          description: null,
          className: 'Montreal',
        },
        [
          {
            amount: -30,
            category: 'Meals',
            description: null,
            className: 'Laval',
          },
          { amount: -20, category: 'Meals', description: null },
        ],
      ).map((l) => l.className),
    ).toEqual(['Montreal', 'Laval', 'Montreal']);
  });

  it('puts the ClassRef on a Purchase line and the CustomField on the Purchase', () => {
    const body = qboBody(
      family({
        lines: [
          {
            category: 'Office Expense',
            cents: 10000,
            description: null,
            className: 'Montreal',
          },
        ],
        fields: [{ ref: '1', value: 'Job 42' }],
      }),
      { bankAccountId: '35', entity: null, accountIds, classIds },
    );
    expect(body).toMatchObject({
      CustomField: [
        { DefinitionId: '1', Type: 'StringType', StringValue: 'Job 42' },
      ],
      Line: [
        {
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: '50' },
            ClassRef: { value: '700' },
          },
        },
      ],
    });
  });

  it('puts the ClassRef on a Deposit line; a class QuickBooks has not = none', () => {
    const body = qboBody(
      family({
        cents: 2550,
        lines: [
          {
            category: 'Sales Income',
            cents: 1550,
            description: null,
            className: 'Montreal',
          },
          {
            category: 'Sales Income',
            cents: 1000,
            description: null,
            className: 'Unknown',
          },
        ],
      }),
      { bankAccountId: '35', entity: null, accountIds, classIds },
    );
    const lines = body.Line as Array<{
      DepositLineDetail: Record<string, unknown>;
    }>;
    expect(lines[0].DepositLineDetail.ClassRef).toEqual({ value: '700' });
    expect(lines[1].DepositLineDetail).not.toHaveProperty('ClassRef');
  });

  it('leaves out what QuickBooks refused', () => {
    const body = qboBody(
      family({
        lines: [
          {
            category: 'Office Expense',
            cents: 10000,
            description: null,
            className: 'Montreal',
          },
        ],
        fields: [{ ref: '1', value: 'Job 42' }],
      }),
      { bankAccountId: '35', entity: null, accountIds, classIds },
      { classes: true, fields: true },
    );
    expect(body).not.toHaveProperty('CustomField');
    expect(JSON.stringify(body)).not.toContain('ClassRef');
  });

  it('the hash moves with a class or a field, and is the old one without them', () => {
    const plain = familyHash(family());
    expect(
      familyHash(
        family({
          lines: [
            {
              category: 'Office Expense',
              cents: 10000,
              description: null,
              className: null,
            },
          ],
        }),
      ),
    ).toBe(plain);
    expect(
      familyHash(
        family({
          lines: [
            {
              category: 'Office Expense',
              cents: 10000,
              description: null,
              className: 'Montreal',
            },
          ],
        }),
      ),
    ).not.toBe(plain);
    expect(
      familyHash(family({ fields: [{ ref: '1', value: 'Job 42' }] })),
    ).not.toBe(plain);
  });
});

describe('location and customer (step11 part 4)', () => {
  const accountIds = new Map([
    ['Office Expense', '50'],
    ['Sales Income', '60'],
  ]);
  const withCustomer = family({
    location: 'Laval',
    lines: [
      {
        category: 'Office Expense',
        cents: 10000,
        description: null,
        customerName: 'Acme',
      },
    ],
  });

  it('a split takes its own customer, else its transaction’s', () => {
    expect(
      familyLines(
        {
          amount: -100,
          category: 'Office Expense',
          description: null,
          customerName: 'Acme',
        },
        [
          {
            amount: -30,
            category: 'Meals',
            description: null,
            customerName: 'Beta',
          },
        ],
      ).map((l) => l.customerName),
    ).toEqual(['Acme', 'Beta']);
  });

  it('puts the DepartmentRef on the Purchase and the CustomerRef on its line', () => {
    const body = qboBody(withCustomer, {
      bankAccountId: '35',
      entity: null,
      accountIds,
      departmentId: '4',
      customerIds: new Map([['Acme', '90']]),
    });
    expect(body).toMatchObject({
      DepartmentRef: { value: '4' },
      Line: [
        {
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: '50' },
            CustomerRef: { value: '90' },
          },
        },
      ],
    });
  });

  it('a Deposit gets the location, never a CustomerRef', () => {
    const body = qboBody(
      family({
        cents: 1000,
        location: 'Laval',
        lines: [
          {
            category: 'Sales Income',
            cents: 1000,
            description: null,
            customerName: 'Acme',
          },
        ],
      }),
      {
        bankAccountId: '35',
        entity: null,
        accountIds,
        departmentId: '4',
        customerIds: new Map([['Acme', '90']]),
      },
    );
    expect(body.DepartmentRef).toEqual({ value: '4' });
    expect(JSON.stringify(body)).not.toContain('CustomerRef');
  });

  it('leaves out what QuickBooks refused', () => {
    const body = qboBody(
      withCustomer,
      {
        bankAccountId: '35',
        entity: null,
        accountIds,
        departmentId: '4',
        customerIds: new Map([['Acme', '90']]),
      },
      { locations: true, customers: true },
    );
    expect(body).not.toHaveProperty('DepartmentRef');
    expect(JSON.stringify(body)).not.toContain('CustomerRef');
  });

  it('the hash moves with them and is the old one without them', () => {
    const plain = familyHash(family());
    expect(familyHash(withCustomer)).not.toBe(plain);
    expect(familyHash(family({ location: 'Laval' }))).not.toBe(plain);
    expect(familyHash(family({ location: null }))).toBe(plain);
  });
});
