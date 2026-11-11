import { signHint } from './statement-extractor';
import type { ReconcileResult } from './reconcile.util';

const check = (name: string, expected: number, actual: number) => ({
  name,
  expected,
  actual,
  ok: expected === actual,
  skipped: null,
});

const result = (checks: ReturnType<typeof check>[]) =>
  ({
    verification: 'MISMATCH',
    checks,
    suspectPages: [],
  }) as unknown as ReconcileResult;

describe('signHint (step8, yakirov CIBC VISA #434)', () => {
  it('names the amount read as credits when both totals are off by it', () => {
    const [hint] = signHint(
      result([
        check('deposits', 1135506, 1246720),
        check('withdrawals', 559780, 448566),
      ]),
    );
    expect(hint).toContain('$1112.14');
    expect(hint).toContain('money IN');
    expect(hint).toContain('$11355.06');
  });

  it('says nothing when the gaps differ (a misread amount, not a sign)', () => {
    expect(
      signHint(
        result([check('deposits', 1000, 1200), check('withdrawals', 500, 400)]),
      ),
    ).toEqual([]);
  });
});
