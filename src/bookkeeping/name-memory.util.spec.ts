import { OWNERS_LOAN, UNCATEGORIZED } from './chart-of-accounts';
import {
  bankPayeeName,
  descriptionKey,
  indexRules,
  isOwnersLoanMove,
  memoryWrites,
  nameMemoryWrites,
  resolveRow,
  resolveRows,
  type MemoryEntry,
  type NameRule,
  type ResolveContext,
} from './name-memory.util';

describe('descriptionKey', () => {
  it('drops reference numbers, card digits, dates and punctuation', () => {
    expect(descriptionKey('POS 0923 WALMART #1234 TORONTO ON')).toBe(
      'pos walmart toronto on',
    );
    expect(descriptionKey('pos 1105 Walmart #9876 Toronto, ON')).toBe(
      'pos walmart toronto on',
    );
  });

  it('strips accents so French descriptions match', () => {
    expect(descriptionKey('Dépôt — PAIE Société 12/09')).toBe(
      'depot paie societe',
    );
  });

  it('drops one-letter tokens and is empty when nothing is left', () => {
    expect(descriptionKey('E-TRANSFER A 1234')).toBe('transfer');
    expect(descriptionKey('0042 / 12-09')).toBe('');
    expect(descriptionKey(null)).toBe('');
  });

  it('is idempotent (a key is its own key)', () => {
    const k = descriptionKey('STRIPE TRANSFER ST-X9Y8');
    expect(descriptionKey(k)).toBe(k);
  });
});

const row = (
  over: Partial<{
    description: string;
    name: string | null;
    offsetAccount: string;
  }> = {},
) => ({
  description: 'POS 0923 WALMART #1234 TORONTO ON',
  name: 'Walmart',
  offsetAccount: 'Supplies',
  ...over,
});

function ctx(
  memory: Record<string, MemoryEntry> = {},
  rules: NameRule[] = [],
): ResolveContext {
  return { memory: new Map(Object.entries(memory)), ...indexRules(rules) };
}

const KEY = 'pos walmart toronto on';

describe('resolveRow precedence: customer rule > firm memory > AI', () => {
  it("keeps the AI's answer when nothing is known", () => {
    expect(resolveRow(row(), ctx())).toMatchObject({
      name: 'Walmart',
      category: 'Supplies',
      source: 'ai',
    });
  });

  it('reuses the firm memory over a different AI answer', () => {
    const out = resolveRow(
      row({ name: 'Wal Mart Store', offsetAccount: 'Office Expense' }),
      ctx({ [KEY]: { name: 'Walmart', category: 'Supplies' } }),
    );
    expect(out).toMatchObject({
      name: 'Walmart',
      category: 'Supplies',
      source: 'memory',
    });
  });

  it("an empty memory field keeps the AI's value", () => {
    const out = resolveRow(
      row({ name: 'Walmart', offsetAccount: 'Supplies' }),
      ctx({ [KEY]: { name: null, category: UNCATEGORIZED } }),
    );
    expect(out).toMatchObject({
      name: 'Walmart',
      category: 'Supplies',
      source: 'ai',
    });
  });

  it("a customer's NAME rule beats the memory", () => {
    const out = resolveRow(
      row(),
      ctx({ [KEY]: { name: 'Walmart', category: 'Supplies' } }, [
        {
          matchType: 'NAME',
          matchKey: 'walmart',
          name: 'Walmart Canada',
          category: 'Office Expense',
        },
      ]),
    );
    expect(out).toMatchObject({
      name: 'Walmart Canada',
      category: 'Office Expense',
      source: 'customer',
    });
  });

  it("a customer's DESCRIPTION rule names an unrecognised row", () => {
    const out = resolveRow(
      row({
        description: 'SERVICE CHARGE 0923',
        name: null,
        offsetAccount: UNCATEGORIZED,
      }),
      ctx({}, [
        {
          matchType: 'DESCRIPTION',
          matchKey: 'service charge',
          name: 'BMO',
          category: 'Bank Fees',
        },
      ]),
    );
    expect(out).toMatchObject({
      name: 'BMO',
      category: 'Bank Fees',
      source: 'customer',
    });
  });

  it('a NAME rule applies to the name a DESCRIPTION rule gave', () => {
    const out = resolveRow(
      row({ description: 'SERVICE CHARGE', name: null }),
      ctx({}, [
        {
          matchType: 'DESCRIPTION',
          matchKey: 'service charge',
          name: 'BMO',
          category: null,
        },
        {
          matchType: 'NAME',
          matchKey: 'bmo',
          name: null,
          category: 'Bank Fees',
        },
      ]),
    );
    expect(out).toMatchObject({
      name: 'BMO',
      category: 'Bank Fees',
      source: 'customer',
    });
  });

  it('a null rule field leaves that value alone', () => {
    const out = resolveRow(
      row(),
      ctx({}, [
        {
          matchType: 'NAME',
          matchKey: 'walmart',
          name: null,
          category: 'Office Expense',
        },
      ]),
    );
    expect(out.name).toBe('Walmart');
    expect(out.category).toBe('Office Expense');
  });

  it('a category outside the chart becomes Uncategorized', () => {
    expect(
      resolveRow(row({ offsetAccount: 'Groceries' }), ctx()).category,
    ).toBe(UNCATEGORIZED);
  });

  it("keeps the customer's own category when it is one of theirs", () => {
    const own = { ...ctx(), customAccounts: new Set(['Groceries']) };
    expect(resolveRow(row({ offsetAccount: 'groceries' }), own).category).toBe(
      'Groceries',
    );
    expect(
      resolveRow(row(), {
        ...ctx({}, [
          {
            matchType: 'NAME',
            matchKey: 'walmart',
            name: null,
            category: 'Groceries',
          },
        ]),
        customAccounts: new Set(['Groceries']),
      }).category,
    ).toBe('Groceries');
  });

  it('matches NAME rules case-insensitively', () => {
    const out = resolveRow(
      row({ name: 'WALMART' }),
      ctx({}, [
        {
          matchType: 'NAME',
          matchKey: 'walmart',
          name: 'Walmart Canada',
          category: null,
        },
      ]),
    );
    expect(out.name).toBe('Walmart Canada');
  });
});

describe('memoryWrites', () => {
  it('stores a new description once, even when it repeats', () => {
    const { creates } = memoryWrites(
      [row(), row({ description: 'POS 1111 WALMART #9 TORONTO ON' })],
      new Map(),
    );
    expect(creates).toEqual([
      {
        descriptionKey: KEY,
        sampleDescription: 'POS 0923 WALMART #1234 TORONTO ON',
        name: 'Walmart',
        category: 'Supplies',
      },
    ]);
  });

  it('never replaces what the memory already knows', () => {
    const { creates, fills } = memoryWrites(
      [row({ name: 'Other Name', offsetAccount: 'Office Expense' })],
      new Map([[KEY, { name: 'Walmart', category: 'Supplies' }]]),
    );
    expect(creates).toEqual([]);
    expect(fills).toEqual([]);
  });

  it('fills a gap the memory had', () => {
    const { fills } = memoryWrites(
      [row()],
      new Map([[KEY, { name: null, category: UNCATEGORIZED }]]),
    );
    expect(fills).toEqual([
      expect.objectContaining({
        descriptionKey: KEY,
        name: 'Walmart',
        category: 'Supplies',
      }),
    ]);
  });

  it('skips an answer with nothing in it, and a description with no key', () => {
    const { creates } = memoryWrites(
      [
        row({ name: null, offsetAccount: UNCATEGORIZED }),
        row({ description: '0042 / 12-09' }),
      ],
      new Map(),
    );
    expect(creates).toEqual([]);
  });
});

describe('bank fees and interest are named after the bank', () => {
  it('uses the name customers know the bank by', () => {
    expect(bankPayeeName('TD Canada Trust')).toBe('TD Bank');
    expect(bankPayeeName('TD')).toBe('TD Bank');
    expect(bankPayeeName('Bank of Montreal')).toBe('BMO');
    expect(bankPayeeName('Royal Bank of Canada')).toBe('RBC');
    expect(bankPayeeName('Tangerine')).toBe('Tangerine');
    expect(bankPayeeName('  ')).toBeNull();
    expect(bankPayeeName(null)).toBeNull();
  });

  it('fills a nameless fee or interest row, and nothing else', () => {
    const c = { ...ctx(), bankName: 'TD Canada Trust' };
    const fee = { description: 'MONTHLY PLAN FEE', offsetAccount: 'Bank Fees' };
    expect(resolveRow(fee, c).name).toBe('TD Bank');
    expect(
      resolveRow(
        { description: 'INTEREST', offsetAccount: 'Interest Income' },
        c,
      ).name,
    ).toBe('TD Bank');
    expect(
      resolveRow(
        { description: 'TRANSFER 0042', offsetAccount: 'Owner Draws' },
        c,
      ).name,
    ).toBeNull();
    // A name the AI read stays.
    expect(resolveRow({ ...fee, name: 'Moneris' }, c).name).toBe('Moneris');
  });

  it("the customer's rule for that name still applies", () => {
    const c = {
      ...ctx({}, [
        {
          matchType: 'NAME',
          matchKey: 'td bank',
          name: null,
          category: 'Office Expense',
        },
      ]),
      bankName: 'TD',
    };
    const out = resolveRow(
      { description: 'SERVICE CHARGE', offsetAccount: 'Bank Fees' },
      c,
    );
    expect(out).toMatchObject({ name: 'TD Bank', category: 'Office Expense' });
  });
});

describe("transfers and credit-card payments go to Owner's Loan", () => {
  it.each([
    ['VISA PAYMENT', 'Uncategorized'],
    ['PAYMENT - VISA 4512', 'Office Expense'],
    ['MASTERCARD PYMT BMO', 'Uncategorized'],
    ['PAYMENT - THANK YOU', 'Uncategorized'],
    ['TFR-TO 1234', 'Uncategorized'],
    ['Online Banking transfer 0042', 'Supplies'],
    ['ANYTHING', 'Transfer Between Accounts'],
    ['ANYTHING', 'Credit Card Payment'],
  ])('%s (%s) is an own move', (description, category) => {
    expect(isOwnersLoanMove(description, category)).toBe(true);
  });

  it.each([
    ['INTERAC E-TRANSFER TO JOHN', 'Uncategorized'],
    ['E-TRANSFER SENT 1234', 'Uncategorized'],
    ['WIRE TRANSFER OUT ACME', 'Uncategorized'],
    ['VISA DEBIT PURCHASE WALMART', 'Supplies'],
    ['BELL CANADA PAYMENT', 'Telephone & Internet'],
  ])('%s (%s) is not', (description, category) => {
    expect(isOwnersLoanMove(description, category)).toBe(false);
  });

  it('overrides the AI and the firm memory', () => {
    const out = resolveRow(
      { description: 'VISA PAYMENT 4512', offsetAccount: 'Office Expense' },
      ctx({ 'visa payment': { name: null, category: 'Supplies' } }),
    );
    expect(out.category).toBe(OWNERS_LOAN);
  });

  it("the customer's own rule still wins", () => {
    const out = resolveRow(
      { description: 'VISA PAYMENT 4512', offsetAccount: 'Office Expense' },
      ctx({}, [
        {
          matchType: 'DESCRIPTION',
          matchKey: 'visa payment',
          name: null,
          category: 'Owner Draw',
        },
      ]),
    );
    expect(out.category).toBe('Owner Draw');
  });
});

describe('one category per name (NameMemory)', () => {
  const named = (c: ResolveContext, nameMemory: Record<string, string>) => ({
    ...c,
    nameMemory: new Map(Object.entries(nameMemory)),
  });

  it("the name's remembered category beats the AI's answer for this row", () => {
    const out = resolveRow(
      row({ offsetAccount: 'Meals & Entertainment' }),
      named(ctx(), { walmart: 'Supplies' }),
    );
    expect(out).toMatchObject({ category: 'Supplies', followsName: true });
  });

  it("the customer's category for the name beats the memory — also after a rename", () => {
    const rules: NameRule[] = [
      {
        matchType: 'NAME',
        matchKey: 'wal-mart',
        name: 'Walmart',
        category: 'Office Expense',
      },
    ];
    const out = resolveRow(
      row(),
      named(ctx({}, rules), { walmart: 'Supplies' }),
    );
    expect(out).toMatchObject({
      category: 'Office Expense',
      followsName: false,
    });
  });

  it("bank fees / interest and Owner's Loan moves keep their own category", () => {
    const c = named(
      { ...ctx(), bankName: 'TD Canada Trust' },
      { 'td bank': 'Bank Fees' },
    );
    const interest = resolveRow(
      {
        description: 'INTEREST PAID',
        name: null,
        offsetAccount: 'Interest Income',
      },
      c,
    );
    expect(interest).toMatchObject({
      name: 'TD Bank',
      category: 'Interest Income',
    });
    const visa = resolveRow(
      {
        description: 'VISA PAYMENT',
        name: 'Walmart',
        offsetAccount: 'Supplies',
      },
      named(ctx(), { walmart: 'Supplies' }),
    );
    expect(visa.category).toBe(OWNERS_LOAN);
  });

  it('within one statement, a new name takes its FIRST category on every row', () => {
    const { resolved, nameMemory } = resolveRows(
      [
        row({
          description: 'COSTCO 1',
          name: 'Costco',
          offsetAccount: 'Supplies',
        }),
        row({
          description: 'COSTCO 2',
          name: 'COSTCO',
          offsetAccount: 'Meals & Entertainment',
        }),
      ],
      ctx(),
    );
    expect(resolved.map((r) => r.category)).toEqual(['Supplies', 'Supplies']);
    expect(nameMemory.get('costco')).toBe('Supplies');
  });

  it('nameMemoryWrites: first answer only, gaps filled, never a customer edit', () => {
    const base = { source: 'ai' as const, followsName: true, learnable: true };
    const out = nameMemoryWrites(
      [
        { ...base, name: 'Costco', category: 'Supplies' },
        { ...base, name: 'costco', category: 'Meals & Entertainment' },
        { ...base, name: 'Staples', category: 'Office Expense' },
        { ...base, name: 'Known', category: 'Supplies' },
        { ...base, name: 'Blank', category: UNCATEGORIZED },
        { ...base, name: 'Mine', category: 'Supplies', learnable: false },
      ],
      new Map([
        ['staples', UNCATEGORIZED],
        ['known', 'Meals & Entertainment'],
      ]),
    );
    expect(out.creates).toEqual([
      { nameKey: 'costco', sampleName: 'Costco', category: 'Supplies' },
    ]);
    expect(out.fills).toEqual([
      { nameKey: 'staples', sampleName: 'Staples', category: 'Office Expense' },
    ]);
  });
});
