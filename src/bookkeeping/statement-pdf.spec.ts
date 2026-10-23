import { runningBalances, statementPdf } from './statement-pdf';

describe('runningBalances', () => {
  const rows = [{ amount: -50 }, { amount: 200 }, { amount: -0.1 }];

  it('adds money in and takes money out for a bank account', () => {
    expect(runningBalances(100, rows, false)).toEqual([50, 250, 249.9]);
  });

  it('runs the balance OWED the other way for a card', () => {
    expect(runningBalances(100, rows, true)).toEqual([150, -50, -49.9]);
  });

  it('is blank with no opening balance', () => {
    expect(runningBalances(null, rows, false)).toEqual([null, null, null]);
  });
});

describe('statementPdf', () => {
  it('builds a PDF', async () => {
    const buf = await statementPdf({
      title: 'Chase 4362 · Sep 2026',
      bankName: 'Chase',
      accountName: 'Chase 4362',
      owner: 'Company1',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-09-30T00:00:00Z'),
      currency: 'USD',
      creditCard: false,
      opening: 1000,
      closing: 950,
      rows: [
        {
          postingDate: new Date('2026-09-03T00:00:00Z'),
          pendingDate: null,
          name: 'Walmart',
          description: 'POS WALMART #1234',
          amount: -50,
        },
      ],
    });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
