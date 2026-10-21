import {
  bankDelayNote,
  defaultAccountName,
  feedCents,
  kindOfPlaidType,
  monthLabel,
  planMonths,
  type FeedTxn,
} from './bank-feed.util';

const t = (id: string, date: string, cents: number): FeedTxn => ({
  id,
  date,
  cents,
});

describe('feedCents', () => {
  it('turns Plaid money-out into our negative cents', () => {
    expect(feedCents(12.34)).toBe(-1234);
    expect(feedCents('-500.10')).toBe(50010);
  });
});

describe('planMonths', () => {
  const txns = [
    t('a', '2026-08-20', -1000), // Aug: −10.00
    t('b', '2026-09-05', 50000), // Sep: +500.00
    t('c', '2026-09-30', -2000), // Sep: −20.00
    t('d', '2026-10-02', -500), //  Oct: −5.00
  ];

  it('walks a bank account backwards from today and chains to the cent', () => {
    const plans = planMonths({
      kind: 'BANK',
      currentCents: 100000,
      today: '2026-10-20',
      txns,
    });
    expect(plans.map((p) => [p.periodStart, p.periodEnd])).toEqual([
      ['2026-08-20', '2026-08-31'],
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-20'],
    ]);
    expect(plans.map((p) => [p.openingCents, p.closingCents])).toEqual([
      [53500, 52500],
      [52500, 100500],
      [100500, 100000],
    ]);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].openingCents).toBe(plans[i - 1].closingCents);
    }
    expect(plans[1].txnIds).toEqual(['b', 'c']);
  });

  it('walks a card the other way (its balance is the amount owed)', () => {
    const plans = planMonths({
      kind: 'CREDIT_CARD',
      currentCents: 30000,
      today: '2026-10-20',
      txns: [t('p', '2026-09-10', -10000), t('q', '2026-10-05', -5000)],
    });
    // October: owed 300 now, a 50 purchase this month → owed 250 at its start.
    expect(plans.map((p) => [p.openingCents, p.closingCents])).toEqual([
      [15000, 25000],
      [25000, 30000],
    ]);
  });

  it('keeps an empty month between two so the chain does not break', () => {
    const plans = planMonths({
      kind: 'BANK',
      currentCents: 0,
      today: '2026-10-03',
      txns: [t('x', '2026-08-15', 100), t('y', '2026-10-01', 100)],
    });
    expect(plans.map((p) => p.periodStart)).toEqual([
      '2026-08-15',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(plans[1].txnIds).toEqual([]);
    expect(plans[1].openingCents).toBe(plans[1].closingCents);
  });

  it('leaves out months an upload covers, keeping the others right', () => {
    const plans = planMonths({
      kind: 'BANK',
      currentCents: 100000,
      today: '2026-10-20',
      txns,
      covered: [{ start: '2026-09-01', end: '2026-09-30' }],
    });
    expect(plans.map((p) => p.periodStart)).toEqual([
      '2026-08-20',
      '2026-10-01',
    ]);
    expect(plans[1].openingCents).toBe(100500);
    expect(plans[0].closingCents).toBe(52500);
  });

  it('drops every month a statement straddles', () => {
    const plans = planMonths({
      kind: 'BANK',
      currentCents: 0,
      today: '2026-10-20',
      txns,
      covered: [{ start: '2026-08-25', end: '2026-09-24' }],
    });
    expect(plans.map((p) => p.periodStart)).toEqual(['2026-10-01']);
  });

  it('gives null balances when Plaid has no current balance', () => {
    const plans = planMonths({
      kind: 'BANK',
      currentCents: null,
      today: '2026-10-20',
      txns,
    });
    expect(
      plans.every((p) => p.openingCents === null && p.closingCents === null),
    ).toBe(true);
  });

  it('makes nothing for an account with no transactions', () => {
    expect(
      planMonths({
        kind: 'BANK',
        currentCents: 5,
        today: '2026-10-20',
        txns: [],
      }),
    ).toEqual([]);
  });

  it('orders by date then id, whatever order they arrive in', () => {
    const plans = planMonths({
      kind: 'BANK',
      currentCents: 0,
      today: '2026-10-20',
      txns: [
        t('z', '2026-10-05', 1),
        t('a', '2026-10-05', 1),
        t('m', '2026-10-01', 1),
      ],
    });
    expect(plans[0].txnIds).toEqual(['m', 'a', 'z']);
  });
  describe('with a start date', () => {
    const plan = (startDate: string | null) =>
      planMonths({
        kind: 'BANK',
        currentCents: 100000,
        today: '2026-10-20',
        txns,
        startDate,
      });

    it('cuts the month it falls in, opening at that day’s balance', () => {
      const plans = plan('2026-09-10');
      expect(plans.map((p) => [p.periodStart, p.periodEnd])).toEqual([
        ['2026-09-10', '2026-09-30'],
        ['2026-10-01', '2026-10-20'],
      ]);
      expect(plans[0].txnIds).toEqual(['c']);
      expect(plans.map((p) => [p.openingCents, p.closingCents])).toEqual([
        [102500, 100500],
        [100500, 100000],
      ]);
    });

    it('starts at a month boundary without cutting anything', () => {
      expect(plan('2026-09-01')).toEqual(plan(null).slice(1));
    });

    it('changes nothing when it is before the first transaction', () => {
      expect(plan('2025-01-01')).toEqual(plan(null));
    });

    it('walks a card the other way', () => {
      const plans = planMonths({
        kind: 'CREDIT_CARD',
        currentCents: 30000,
        today: '2026-10-20',
        txns: [t('p', '2026-09-10', -10000), t('q', '2026-10-05', -5000)],
        startDate: '2026-10-03',
      });
      expect(
        plans.map((p) => [p.periodStart, p.openingCents, p.closingCents]),
      ).toEqual([['2026-10-03', 25000, 30000]]);
    });
  });
});

describe('helpers', () => {
  it('labels a month', () => expect(monthLabel('2026-03-01')).toBe('Mar 2026'));

  it('names a new account "<bank> <last 4>"', () => {
    expect(
      defaultAccountName('TD Canada Trust', { name: 'Chequing', mask: '5234' }),
    ).toBe('TD Canada Trust 5234');
    expect(defaultAccountName(null, { name: 'Chequing', mask: null })).toBe(
      'Chequing Chequing',
    );
  });

  it('treats only credit accounts as cards', () => {
    expect(kindOfPlaidType('credit')).toBe('CREDIT_CARD');
    expect(kindOfPlaidType('depository')).toBe('BANK');
  });
});

describe('bankDelayNote', () => {
  const failed = { last_failed_update: '2026-10-21T22:34:34Z' };
  it('blames the bank when Plaid marks it down', () => {
    expect(
      bankDelayNote('TD Canada Trust', failed, { updates: 'DOWN' }),
    ).toMatch(/^TD Canada Trust isn't sending transactions to Plaid/);
    expect(bankDelayNote(null, failed, { updates: 'DEGRADED' })).toMatch(
      /^your bank/,
    );
  });
  it('explains a bank that only allows updates at set hours (TD)', () => {
    expect(bankDelayNote('TD', failed, { openIncidents: 1 })).toMatch(
      /^TD only lets Plaid collect transactions at certain hours/,
    );
  });
  it('says Plaid is still trying when the bank looks fine', () => {
    expect(bankDelayNote('TD', failed, { updates: 'HEALTHY' })).toMatch(
      /^Plaid couldn't get your transactions from TD yet/,
    );
  });
  it('is null while nothing failed, or once an update worked', () => {
    expect(bankDelayNote('TD', {}, { updates: 'DOWN' })).toBeNull();
    expect(bankDelayNote('TD', null, null)).toBeNull();
    expect(
      bankDelayNote(
        'TD',
        { ...failed, last_successful_update: '2026-10-21T23:00:00Z' },
        { updates: 'DOWN' },
      ),
    ).toBeNull();
  });
});
