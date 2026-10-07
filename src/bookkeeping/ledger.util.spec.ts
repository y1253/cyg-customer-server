import { UNCATEGORIZED } from './chart-of-accounts';
import {
  buildLedgerRows,
  doubleEntry,
  parseIsoDate,
  toMoney,
} from './ledger.util';
import { netOf } from './export.service';
import { parseExtraction } from './statement-extractor';

const BANK = 'Chase 4362';

describe('doubleEntry — the bank is an asset', () => {
  it('money IN (Stripe 50): debit the bank, credit the offset', () => {
    expect(doubleEntry(50, BANK, 'Sales Income')).toEqual({
      debitAccount: BANK,
      creditAccount: 'Sales Income',
    });
  });

  it('money OUT (Walmart -50): debit the offset, credit the bank', () => {
    expect(doubleEntry(-50, BANK, 'Office Expense')).toEqual({
      debitAccount: 'Office Expense',
      creditAccount: BANK,
    });
  });

  it('a refund (+) credits the expense it reverses', () => {
    expect(doubleEntry(21.4, BANK, 'Office Expense').creditAccount).toBe(
      'Office Expense',
    );
  });
});

describe('parseIsoDate', () => {
  it('reads YYYY-MM-DD as UTC midnight', () => {
    expect(parseIsoDate('2026-09-30')?.toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it.each(['09/30/2026', '2026-02-31', '', null, 'soon'])(
    'refuses %p rather than guessing',
    (raw) => {
      expect(parseIsoDate(raw)).toBeNull();
    },
  );
});

describe('toMoney', () => {
  it('rounds to cents without float noise', () => {
    expect(toMoney(0.1 + 0.2)).toBe('0.30');
    expect(toMoney(-84.375)).toBe('-84.37');
    expect(toMoney('$1,250.00')).toBe('1250.00');
  });

  it('refuses non-numbers', () => {
    expect(toMoney(NaN)).toBeNull();
    expect(toMoney('abc')).toBeNull();
  });
});

describe('buildLedgerRows', () => {
  it('keeps statement order, drops lines without an amount, and maps unknown accounts', () => {
    const rows = buildLedgerRows(
      [
        {
          pendingDate: null,
          postingDate: '2026-09-01',
          description: 'STRIPE',
          amount: 50,
          offsetAccount: 'Sales Income',
        },
        {
          pendingDate: null,
          postingDate: '2026-09-02',
          description: 'BALANCE',
          amount: NaN,
          offsetAccount: 'Sales Income',
        },
        {
          pendingDate: null,
          postingDate: '2026-09-02',
          description: 'WALMART',
          amount: -50,
          offsetAccount: 'Groceries??',
        },
      ],
      BANK,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({
      amount: '50.00',
      debitAccount: BANK,
      creditAccount: 'Sales Income',
    });
    expect(rows[1]).toMatchObject({
      amount: '-50.00',
      offsetAccount: UNCATEGORIZED,
      debitAccount: UNCATEGORIZED,
      creditAccount: BANK,
    });
  });
});

describe('parseExtraction', () => {
  it('normalises a schema-shaped reply', () => {
    const out = parseExtraction(
      JSON.stringify({
        isBankStatement: true,
        accountName: ' Chase 4362 ',
        periodStart: '2026-09-01',
        periodEnd: null,
        transactions: [
          {
            pendingDate: null,
            postingDate: '2026-09-02',
            description: 'WALMART',
            amount: -50,
            offsetAccount: 'Office Expense',
          },
        ],
      }),
    );
    expect(out.accountName).toBe('Chase 4362');
    expect(out.transactions[0]).toMatchObject({
      amount: -50,
      offsetAccount: 'Office Expense',
    });
  });

  it('throws on a non-JSON reply', () => {
    expect(() => parseExtraction('Sure! Here are the transactions')).toThrow();
  });
});

describe('netOf', () => {
  it('sums in cents, with no float drift', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({
      amount: i % 2 ? -38.73 : 0.1,
    }));
    expect(netOf(rows)).toBe(-2897.25);
    expect(netOf([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
});
