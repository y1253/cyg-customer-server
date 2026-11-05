import {
  descriptionKey,
  EXCEPTION,
  exceptionKey,
  indexRules,
  resolveRow,
  type MemoryEntry,
  type NameRule,
  type ResolveContext,
} from './name-memory.util';

/** step9: every row knows which rule named it, and a one-time edit is an EXCEPTION rule. */
const DESC = 'POS 0923 WALMART #1234 TORONTO ON';
const KEY = descriptionKey(DESC);
const row = (
  over: Partial<{ name: string | null; exceptionKey: string }> = {},
) => ({
  description: DESC,
  name: 'WALMART',
  offsetAccount: 'Supplies',
  ...over,
});

function ctx(
  memory: Record<string, MemoryEntry> = {},
  rules: NameRule[] = [],
): ResolveContext {
  return { memory: new Map(Object.entries(memory)), ...indexRules(rules) };
}

describe('resolveRow provenance (step9)', () => {
  it('records the firm memory row that named it', () => {
    const out = resolveRow(
      row(),
      ctx({ [KEY]: { id: 41, name: 'Walmart', category: 'Supplies' } }),
    );
    expect(out).toMatchObject({
      name: 'Walmart',
      generalRuleId: 41,
      personalRuleId: null,
      exceptionRuleId: null,
      ruleName: 'Walmart',
    });
  });

  it("records the customer's rule that named it, over the memory", () => {
    const out = resolveRow(
      row(),
      ctx({ [KEY]: { id: 41, name: 'Walmart', category: 'Supplies' } }, [
        {
          id: 7,
          matchType: 'DESCRIPTION',
          matchKey: KEY,
          name: 'Walmart Canada',
          category: null,
        },
      ]),
    );
    expect(out).toMatchObject({
      name: 'Walmart Canada',
      generalRuleId: 41,
      personalRuleId: 7,
    });
  });

  it('a CONTAINS rule is the personal rule of the rows it names', () => {
    const out = resolveRow(
      row(),
      ctx({}, [
        {
          id: 9,
          matchType: 'CONTAINS',
          matchKey: 'walmart',
          name: 'Walmart',
          category: null,
        },
      ]),
    );
    expect(out).toMatchObject({ name: 'Walmart', personalRuleId: 9 });
  });

  it('applies a one-time edit LAST and keeps the name the rules give as ruleName', () => {
    const key = exceptionKey({
      statementId: 3,
      postingDate: '2026-10-02',
      amount: -12.5,
      description: DESC,
    });
    const rules: NameRule[] = [
      {
        id: 7,
        matchType: 'DESCRIPTION',
        matchKey: KEY,
        name: 'Walmart',
        category: null,
      },
      {
        id: 12,
        matchType: EXCEPTION,
        matchKey: key,
        name: 'Costco',
        category: 'Office Expense',
      },
    ];
    const out = resolveRow(row({ exceptionKey: key }), ctx({}, rules));
    expect(out).toMatchObject({
      name: 'Costco',
      category: 'Office Expense',
      personalRuleId: 7,
      exceptionRuleId: 12,
      ruleName: 'Walmart',
      learnable: false,
    });
    // Another row of the same description is no exception.
    expect(resolveRow(row(), ctx({}, rules))).toMatchObject({
      name: 'Walmart',
      exceptionRuleId: null,
    });
  });
});

describe('exceptionKey (step9)', () => {
  const base = {
    statementId: 3,
    postingDate: '2026-10-02',
    amount: -12.5,
    description: DESC,
  };

  it('finds the same row again after a re-read (same statement, day, amount, description)', () => {
    expect(exceptionKey(base)).toBe(
      exceptionKey({
        ...base,
        postingDate: new Date('2026-10-02T00:00:00Z'),
        amount: { toString: () => '-12.50' },
      }),
    );
  });

  it('tells apart rows that differ in amount, day or description, and fits the column', () => {
    expect(exceptionKey(base)).not.toBe(
      exceptionKey({ ...base, amount: -12.51 }),
    );
    expect(exceptionKey(base)).not.toBe(
      exceptionKey({ ...base, postingDate: '2026-10-03' }),
    );
    expect(exceptionKey(base)).not.toBe(
      exceptionKey({ ...base, description: 'POS 0923 COSTCO' }),
    );
    expect(
      exceptionKey({ ...base, description: 'x'.repeat(600) }).length,
    ).toBeLessThanOrEqual(191);
  });

  it('a bank-feed row is keyed by its Plaid id', () => {
    expect(exceptionKey({ ...base, externalId: 'abc123' })).toBe('p:abc123');
  });
});
