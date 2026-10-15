import {
  cadPerOn,
  FX_GAIN_LOSS,
  rateOn,
  revaluationRows,
  toHome,
  type RateSeries,
} from './fx.util';

const USD: RateSeries = [
  { date: '2026-09-01', cadPer: 1.35 },
  { date: '2026-09-02', cadPer: 1.36 },
  { date: '2026-09-30', cadPer: 1.4 },
];
const EUR: RateSeries = [{ date: '2026-09-01', cadPer: 1.5 }];
const seriesOf = (c: string) => ({ USD, EUR })[c as 'USD' | 'EUR'];

describe('Bank of Canada rates', () => {
  it("uses the day's rate, else the latest one before it (weekends, holidays)", () => {
    expect(cadPerOn('USD', '2026-09-02', USD)).toBe(1.36);
    expect(cadPerOn('USD', '2026-09-05', USD)).toBe(1.36);
    expect(cadPerOn('USD', '2026-08-31', USD)).toBeNull();
    expect(cadPerOn('CAD', '2026-08-31', undefined)).toBe(1);
  });

  it('converts between two foreign currencies through CAD', () => {
    expect(rateOn('USD', 'CAD', '2026-09-01', seriesOf)).toBe(1.35);
    expect(rateOn('CAD', 'USD', '2026-09-01', seriesOf)).toBeCloseTo(
      1 / 1.35,
      12,
    );
    expect(rateOn('USD', 'EUR', '2026-09-01', seriesOf)).toBeCloseTo(0.9, 12);
    expect(rateOn('USD', 'USD', '2020-01-01', seriesOf)).toBe(1);
    expect(rateOn('JPY', 'CAD', '2026-09-01', seriesOf)).toBeNull();
  });

  it('rounds the converted amount to the cent', () => {
    expect(toHome(-100.01, 1.3512)).toBe(-135.13);
  });
});

describe('revaluationRows', () => {
  it("brings the account to its foreign balance at the period end's rate", () => {
    // $1,000 USD in on Sep 1 at 1.35 = 1,350 CAD; at Sep 30 (1.40) it is worth 1,400.
    const [row] = revaluationRows([
      {
        statementId: 1,
        bankAccount: 'Chase USD',
        periodEnd: '2026-09-30',
        foreign: 1000,
        home: 1350,
        closingRate: 1.4,
      },
    ]);
    expect(row).toMatchObject({
      amount: 0,
      homeAmount: 50,
      offsetAccount: FX_GAIN_LOSS,
      debitAccount: 'Chase USD',
      creditAccount: FX_GAIN_LOSS,
    });
  });

  it('counts the earlier revaluation, and a loss posts the other way', () => {
    const rows = revaluationRows([
      {
        statementId: 2,
        bankAccount: 'Chase USD',
        periodEnd: '2026-10-31',
        foreign: 0,
        home: 0,
        closingRate: 1.3,
      },
      {
        statementId: 1,
        bankAccount: 'Chase USD',
        periodEnd: '2026-09-30',
        foreign: 1000,
        home: 1350,
        closingRate: 1.4,
      },
    ]);
    // Sep: +50 (1,400). Oct: nothing moved, the rate fell to 1.30 → −100 (1,300).
    expect(rows.map((r) => [r.statementId, r.homeAmount])).toEqual([
      [1, 50],
      [2, -100],
    ]);
    expect(rows[1]).toMatchObject({
      debitAccount: FX_GAIN_LOSS,
      creditAccount: 'Chase USD',
    });
  });

  it('posts nothing when the balance already matches or no rate is known', () => {
    expect(
      revaluationRows([
        {
          statementId: 1,
          bankAccount: 'A',
          periodEnd: '2026-09-30',
          foreign: 100,
          home: 140,
          closingRate: 1.4,
        },
        {
          statementId: 2,
          bankAccount: 'B',
          periodEnd: '2026-09-30',
          foreign: 100,
          home: 135,
          closingRate: null,
        },
      ]),
    ).toEqual([]);
  });
});
