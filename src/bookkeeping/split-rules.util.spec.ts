import {
  directionOf,
  ratesLabel,
  ruleSplits,
  type SplitRule,
} from './split-rules.util';

const pct = (kind: 'SALES' | 'PURCHASE', rate: number) => ({
  kind,
  mode: 'PERCENT' as const,
  rate,
  amount: null,
});
const fixed = (kind: 'SALES' | 'PURCHASE', amount: number) => ({
  kind,
  mode: 'FIXED' as const,
  rate: 0,
  amount,
});
const rule = (
  id: number,
  rates: SplitRule['rates'],
  category: string | null = null,
): SplitRule => ({ id, name: `R${id}`, category, rates });

describe('directionOf', () => {
  it('money in is In, money out is Out, zero is none', () => {
    expect(directionOf(5)).toBe('SALES');
    expect(directionOf(-5)).toBe('PURCHASE');
    expect(directionOf(0)).toBeNull();
  });
});

describe('ruleSplits', () => {
  it('takes a percent INCLUDED in the amount', () => {
    expect(ruleSplits(100, [rule(1, [pct('SALES', 10)])])).toEqual([
      { ruleId: 1, category: 'R1', amount: 9.09 },
    ]);
  });

  it('uses the Out rate on money out, and nothing without one', () => {
    const r = rule(1, [pct('SALES', 10), pct('PURCHASE', 5)]);
    expect(ruleSplits(-105, [r])).toEqual([
      { ruleId: 1, category: 'R1', amount: 5 },
    ]);
    expect(ruleSplits(-105, [rule(2, [pct('SALES', 10)])])).toEqual([]);
  });

  it('splits a fixed amount, then percents on what is left', () => {
    const out = ruleSplits(-112, [
      rule(1, [pct('PURCHASE', 10)]),
      rule(2, [fixed('PURCHASE', 2)], 'Bank Fees'),
    ]);
    expect(out).toEqual([
      { ruleId: 2, category: 'Bank Fees', amount: 2 },
      { ruleId: 1, category: 'R1', amount: 10 },
    ]);
  });

  it('several percents add back to the cent', () => {
    const out = ruleSplits(100, [
      rule(1, [pct('SALES', 5)]),
      rule(2, [pct('SALES', 9.975)]),
    ]);
    const total = out.reduce((n, s) => n + Math.round(s.amount * 100), 0);
    expect(total).toBe(Math.round((10000 * 14.975) / 114.975));
  });

  it('never takes more than the line', () => {
    expect(
      ruleSplits(3, [
        rule(1, [fixed('SALES', 5)]),
        rule(2, [pct('SALES', 10)]),
      ]),
    ).toEqual([{ ruleId: 1, category: 'R1', amount: 3 }]);
  });

  it('a zero line or a zero rate gives nothing', () => {
    expect(ruleSplits(0, [rule(1, [pct('SALES', 10)])])).toEqual([]);
    expect(ruleSplits(10, [rule(1, [pct('SALES', 0)])])).toEqual([]);
  });
});

describe('ratesLabel', () => {
  it('says In / Out with % or $', () => {
    expect(ratesLabel([pct('SALES', 5), fixed('PURCHASE', 2)])).toBe(
      'In 5% · Out $2.00',
    );
  });
});
