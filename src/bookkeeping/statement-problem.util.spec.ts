import {
  needsReviewText,
  PROBLEM_TITLES,
  statementProblem,
  type ProblemInput,
} from './statement-problem.util';

const done = (over: Partial<ProblemInput> = {}): ProblemInput => ({
  status: 'DONE',
  error: null,
  verification: 'VERIFIED',
  verificationDetail: [
    {
      name: 'balance',
      expected: 10000,
      actual: 10000,
      ok: true,
      skipped: null,
    },
  ],
  source: 'UPLOAD',
  openingBalance: 50,
  closingBalance: 100,
  ...over,
});

describe('statementProblem (step2, 2026-11-11)', () => {
  it('a statement that checks out and carries over has none', () => {
    expect(statementProblem(done())).toBeNull();
  });

  it('NEEDS_REVIEW: its rows do not reach its balance', () => {
    const p = statementProblem(
      done({
        status: 'NEEDS_REVIEW',
        error: 'It starts at $50.00 …',
        verificationDetail: [
          {
            name: 'balance',
            expected: 10000,
            actual: 9000,
            ok: false,
            skipped: null,
          },
        ],
      }),
    );
    expect(p).toEqual({
      kind: 'BALANCE',
      title: PROBLEM_TITLES.BALANCE,
      text: 'It starts at $50.00 …',
    });
  });

  it("NEEDS_REVIEW with the balance right says the bank's totals are off", () => {
    const p = statementProblem(
      done({
        status: 'NEEDS_REVIEW',
        verificationDetail: [
          { name: 'balance', expected: 1, actual: 1, ok: true, skipped: null },
          {
            name: 'deposits',
            expected: 5,
            actual: 4,
            ok: false,
            skipped: null,
          },
        ],
      }),
    );
    expect(p?.kind).toBe('BALANCE');
    expect(p?.title).toBe("Transactions don't match the bank's totals");
  });

  it('MISMATCH: says both balances, and that both were re-read', () => {
    const reason = {
      kind: 'MISMATCH' as const,
      previousStatementId: 1,
      previousEnd: '2026-02-28',
      previousClosing: 1200,
      opening: 1150.5,
    };
    const p = statementProblem(done({ reason, rechecked: true }));
    expect(p?.kind).toBe('MISMATCH');
    expect(p?.title).toBe("Statement didn't match");
    expect(p?.text).toBe(
      'The statement ending Feb 28, 2026 closes at $1,200.00; this one opens at $1,150.50. ' +
        "We re-read both with our strongest reader and they still don't match, so your books start again here at $1,150.50.",
    );
    expect(
      statementProblem(done({ reason, rechecking: true }))?.text,
    ).toContain("We're re-reading both");
  });

  it('MISSING: names the gap', () => {
    const p = statementProblem(
      done({
        openingBalance: 300,
        reason: {
          kind: 'MISSING',
          previousStatementId: 1,
          from: '2026-03-01',
          to: '2026-04-30',
        },
      }),
    );
    expect(p).toEqual({
      kind: 'MISSING',
      title: 'Missing statements',
      text: 'No statement from Mar 1, 2026 to Apr 30, 2026. Your books start again here at $300.00. Upload the missing statements to fix it.',
    });
  });

  it('NO_BALANCES: nothing checked its rows', () => {
    const p = statementProblem(
      done({
        verification: 'UNVERIFIED',
        verificationDetail: [],
        closingBalance: null,
      }),
    );
    expect(p?.kind).toBe('NO_BALANCES');
    expect(p?.text).toContain("couldn't read this statement's closing balance");
  });

  it('none for a statement proved by its totals / running balance with no closing line (TD)', () => {
    expect(
      statementProblem(
        done({
          closingBalance: null,
          verificationDetail: [
            {
              name: 'deposits',
              expected: 5,
              actual: 5,
              ok: true,
              skipped: null,
            },
            {
              name: 'runningBalance',
              expected: 9,
              actual: 9,
              ok: true,
              skipped: null,
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('never for a bank-feed month or a statement still being read', () => {
    expect(
      statementProblem(done({ source: 'PLAID', verificationDetail: [] })),
    ).toBeNull();
    expect(statementProblem(done({ status: 'PROCESSING' }))).toBeNull();
  });

  it('a break wins over missing balances', () => {
    const p = statementProblem(
      done({
        verificationDetail: [],
        reason: {
          kind: 'MISSING',
          previousStatementId: 1,
          from: '2026-03-01',
          to: null,
        },
      }),
    );
    expect(p?.kind).toBe('MISSING');
  });
});

describe('needsReviewText', () => {
  it('spells out the balance it should reach', () => {
    expect(
      needsReviewText({
        rereads: 10,
        openingBalance: 100,
        amounts: [50, -20, -5.5],
        checks: [
          {
            name: 'balance',
            expected: 13000,
            actual: 12450,
            ok: false,
            skipped: null,
          },
        ],
      }),
    ).toBe(
      'It starts at $100.00; with the money in ($50.00) and out ($25.50) we read, it should end at $124.50 — ' +
        'but the statement ends at $130.00 (off by $5.50). We re-read it 10 times, including with our strongest reader. ' +
        'Nothing from it is in your books yet — try again, or ask the AI to fix it.',
    );
  });

  it('lists the failed totals when the balance is not the problem', () => {
    expect(
      needsReviewText({
        rereads: 1,
        openingBalance: null,
        amounts: [],
        checks: [
          {
            name: 'deposits',
            expected: 500,
            actual: 400,
            ok: false,
            skipped: null,
          },
        ],
      }),
    ).toContain(
      "don't add up to the bank's own figures: Deposits: statement $5.00, read $4.00 (off by $1.00). We re-read it 1 time,",
    );
  });
});

describe('ENDING and the balance across a gap (step2, 2026-11-12)', () => {
  it('a read statement whose opening ± its rows misses its closing is ENDING', () => {
    const p = statementProblem(done({ net: 40 }));
    expect(p?.kind).toBe('ENDING');
    expect(p?.title).toBe(PROBLEM_TITLES.ENDING);
    expect(p?.text).toContain('should end at $90.00');
    expect(p?.text).toContain('ends at $100.00 (off by $10.00)');
    expect(statementProblem(done({ net: 50 }))).toBeNull();
  });

  it('a card ends at opening − net (the amount owed); a bank-feed month or no rows sum is never checked', () => {
    expect(
      statementProblem(done({ accountKind: 'CREDIT_CARD', net: -50 })),
    ).toBeNull();
    expect(
      statementProblem(done({ accountKind: 'CREDIT_CARD', net: 50 }))?.kind,
    ).toBe('ENDING');
    expect(statementProblem(done({ source: 'PLAID', net: 1 }))).toBeNull();
    expect(statementProblem(done())).toBeNull();
    expect(statementProblem(done({ closingBalance: null, net: 1 }))).toBeNull();
  });

  it('MISSING says when the balance jumped across the gap ($1,024.43 → $0)', () => {
    const p = statementProblem(
      done({
        openingBalance: 0,
        closingBalance: 0,
        net: 0,
        reason: {
          kind: 'MISSING',
          previousStatementId: 273,
          from: '2025-03-21',
          to: '2025-06-20',
          previousClosing: 1024.43,
          opening: 0,
        },
      }),
    );
    expect(p?.kind).toBe('MISSING');
    expect(p?.text).toContain(
      'The statement before it ends at $1,024.43; this one opens at $0.00.',
    );
  });
});
