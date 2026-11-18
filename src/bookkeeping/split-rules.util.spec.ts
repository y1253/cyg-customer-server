import {
  directionOf,
  ratesLabel,
  ruleSplits,
  ruleSteps,
  stepSplits,
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
  groupId: number | null = null,
): SplitRule => ({ id, name: `R${id}`, category, groupId, rates });

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

describe('ruleSteps', () => {
  it('an individual rule is its own step, a group one step at its first rule', () => {
    const a = rule(1, [pct('SALES', 1)]);
    const g1 = rule(2, [pct('SALES', 2)], null, 7);
    const b = rule(3, [pct('SALES', 3)]);
    const g2 = rule(4, [pct('SALES', 4)], null, 7);
    expect(ruleSteps([a, g1, b, g2]).map((s) => s.map((r) => r.id))).toEqual([
      [1],
      [2, 4],
      [3],
    ]);
  });
});

describe('stepSplits', () => {
  const gst = (g: number | null = null) => rule(1, [pct('SALES', 5)], null, g);
  const qst = (g: number | null = null) =>
    rule(2, [pct('SALES', 9.975)], null, g);

  it('individual rules cut one after the other', () => {
    expect(stepSplits(100, [gst(), qst()])).toEqual([
      { ruleId: 1, category: 'R1', amount: 4.76 },
      { ruleId: 2, category: 'R2', amount: 8.64 },
    ]);
  });

  it('applied one at a time gives the same as all at once', () => {
    const first = stepSplits(100, [gst()]);
    const second = stepSplits(100 - first[0].amount, [qst()]);
    expect([...first, ...second]).toEqual(stepSplits(100, [gst(), qst()]));
  });

  it('a group cuts the same amount together', () => {
    expect(stepSplits(100, [gst(9), qst(9)])).toEqual([
      { ruleId: 1, category: 'R1', amount: 4.35 },
      { ruleId: 2, category: 'R2', amount: 8.67 },
    ]);
  });

  it('a group after an individual rule works on what it left', () => {
    const fee = rule(3, [fixed('PURCHASE', 10)], 'Bank Fees');
    const out = stepSplits(-124.98, [
      fee,
      rule(4, [pct('PURCHASE', 5)], null, 9),
      rule(5, [pct('PURCHASE', 9.975)], null, 9),
    ]);
    expect(out[0]).toEqual({ ruleId: 3, category: 'Bank Fees', amount: 10 });
    // 114.98 left: 14.975% included = 14.98 in all.
    expect(Math.round((out[1].amount + out[2].amount) * 100)).toBe(1498);
  });

  it('stops when nothing is left', () => {
    expect(
      stepSplits(5, [rule(1, [fixed('SALES', 5)]), rule(2, [pct('SALES', 10)])]),
    ).toEqual([{ ruleId: 1, category: 'R1', amount: 5 }]);
  });
});

describe('ratesLabel', () => {
  it('says In / Out with % or $', () => {
    expect(ratesLabel([pct('SALES', 5), fixed('PURCHASE', 2)])).toBe(
      'In 5% · Out $2.00',
    );
  });
});
