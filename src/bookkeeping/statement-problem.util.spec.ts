import {
  needsReviewText,
  printedEnding,
  PROBLEM_TITLES,
  statementErrors,
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

  it("MISMATCH where the previous statement's running balance ends at this opening: its rows were read wrong (TD 4051 #207 → #220)", () => {
    const reason = {
      kind: 'MISMATCH' as const,
      previousStatementId: 207,
      previousEnd: '2021-12-31',
      previousClosing: null,
      opening: 31.26,
    };
    const p = statementProblem(done({ reason, previousPrinted: 31.26 }));
    expect(p?.kind).toBe('MISMATCH');
    expect(p?.text).toBe(
      'The statement ending Dec 31, 2021 ends at $31.26 by its own running balance — where this one opens — ' +
        "but its transactions as read don't add up to that, so one of them was read wrong. " +
        'Your books start again here at $31.26 until that statement is read again.',
    );
    // A running balance ending elsewhere keeps the usual text.
    expect(
      statementProblem(done({ reason, previousPrinted: 17.46 }))?.text,
    ).toContain('has no closing balance we could read');
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

describe('step9: running balance and starting balance', () => {
  it('RUNNING when the last printed running balance misses the closing', () => {
    const errors = statementErrors(done({ net: 50, printedEnding: 90 }));
    expect(errors.map((e) => e.kind)).toEqual(['RUNNING']);
    expect(errors[0].text).toContain('$90.00');
    expect(errors[0].text).toContain('off by $10.00');
  });

  it('no RUNNING when it reaches the closing (either sign) or nothing is printed', () => {
    expect(statementErrors(done({ net: 50, printedEnding: 100 }))).toEqual([]);
    expect(statementErrors(done({ net: 50, printedEnding: -100 }))).toEqual([]);
    expect(statementErrors(done({ net: 50, printedEnding: null }))).toEqual([]);
    expect(
      statementErrors(done({ net: 50, printedEnding: 90, source: 'PLAID' })),
    ).toEqual([]);
  });

  it('no closing printed: the running balance is checked against opening + rows', () => {
    const errors = statementErrors(
      done({ closingBalance: null, net: 50, printedEnding: 99 }),
    );
    expect(errors.map((e) => e.kind)).toEqual(['RUNNING']);
  });

  it('a skipped runningBalance check (not a running balance) is not checked', () => {
    expect(
      statementErrors(
        done({
          net: 50,
          printedEnding: 90,
          verificationDetail: [
            {
              name: 'runningBalance',
              expected: 3,
              actual: 0,
              ok: false,
              skipped: 'not a running balance',
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('NO_OPENING only when no starting balance could be worked out', () => {
    const none = done({
      openingBalance: null,
      closingBalance: null,
      startDerived: 'ZERO',
      verification: 'UNVERIFIED',
      verificationDetail: [],
    });
    expect(statementErrors(none).map((e) => e.kind)).toEqual(['NO_OPENING']);
    // Worked out from the closing balance: not an error (user's decision).
    expect(
      statementErrors(done({ openingBalance: null, startDerived: 'CLOSING' })),
    ).toEqual([]);
  });

  it('statementProblem is the worst of statementErrors', () => {
    const p = statementProblem(
      done({ net: 1, printedEnding: 90 }), // ENDING (50 + 1 ≠ 100) and RUNNING
    );
    expect(p?.kind).toBe('ENDING');
    expect(
      statementErrors(done({ net: 1, printedEnding: 90 })).map((e) => e.kind),
    ).toEqual(['ENDING', 'RUNNING']);
  });
});

describe('printedEnding', () => {
  it('the last printed balance, oldest first', () => {
    expect(
      printedEnding([
        { balanceAfter: 10, postingDate: '2026-01-01' },
        { balanceAfter: null, postingDate: '2026-01-02' },
        { balanceAfter: 30, postingDate: '2026-01-03' },
        { balanceAfter: null, postingDate: '2026-01-04' },
      ]),
    ).toBe(30);
  });

  it('the newest printed balance when the rows run newest first', () => {
    expect(
      printedEnding([
        { balanceAfter: 30, postingDate: '2026-01-03', amount: 20 },
        { balanceAfter: 10, postingDate: '2026-01-01', amount: 10 },
      ]),
    ).toBe(30);
  });

  it('carries the last printed balance through the rows after it', () => {
    expect(
      printedEnding([
        { balanceAfter: 100, postingDate: '2026-01-01', amount: 100 },
        { balanceAfter: null, postingDate: '2026-01-02', amount: -40 },
        { balanceAfter: null, postingDate: '2026-01-03', amount: -10 },
      ]),
    ).toBe(50);
  });

  it('a card: what is owed goes up with a purchase', () => {
    expect(
      printedEnding(
        [
          { balanceAfter: 100, postingDate: '2026-01-01', amount: -100 },
          { balanceAfter: null, postingDate: '2026-01-02', amount: -25 },
        ],
        true,
      ),
    ).toBe(125);
  });

  // Production, 2026-11-16: Wise #340 prints the newest row at the top of page 1 and no
  // running balance was read on its 11 newest rows. It said "$3,544.12 vs closing $0.00".
  const wise340 = [
    ['2025-11-03', -1000, null],
    ['2025-11-03', 1000, null],
    ['2025-10-28', -2000, null],
    ['2025-10-28', 2000, null],
    ['2025-10-27', -1000, null],
    ['2025-10-27', 1000, null],
    ['2025-09-29', -2000, null],
    ['2025-09-29', 2000, null],
    ['2025-09-28', -3000, null],
    ['2025-09-28', 3000, null],
    ['2025-09-25', -3544.12, null],
    ['2025-09-22', 3500, 3544.12],
    ['2025-09-19', -5.88, 44.12],
    ['2025-09-18', 50, 50],
    ['2025-09-18', -2300, 0],
    ['2025-09-18', 2300, 2300],
    ['2025-09-16', -2800, 0],
    ['2025-09-16', 2800, 2800],
  ].map(([postingDate, amount, balanceAfter]) => ({
    postingDate: postingDate as string,
    amount: amount as number,
    balanceAfter: balanceAfter as number | null,
  }));

  it('Wise #340 (newest first) ends at its $0.00 closing', () => {
    expect(printedEnding(wise340)).toBe(0);
    expect(printedEnding([...wise340].reverse())).toBe(0);
    expect(
      statementErrors(
        done({
          openingBalance: 0,
          closingBalance: 0,
          net: 0,
          printedEnding: printedEnding(wise340),
        }),
      ),
    ).toEqual([]);
  });

  it('Wise #336: $3 on Dec 11 and the rows after it end at $0.00', () => {
    const rows = [
      ['2025-12-28', -4035, null],
      ['2025-12-28', 4025, null],
      ['2025-12-26', -6465, null],
      ['2025-12-25', 6475, null],
      ['2025-12-24', -840, null],
      ['2025-12-24', 840, null],
      ['2025-12-23', -905, null],
      ['2025-12-23', 900, null],
      ['2025-12-18', -550, null],
      ['2025-12-17', 555, null],
      ['2025-12-16', -1243, null],
      ['2025-12-16', 1240, null],
      ['2025-12-11', -1050, 3],
      ['2025-12-10', 1050, 1053],
      ['2025-12-10', -697, 3],
      ['2025-12-09', 700, 700],
    ].map(([postingDate, amount, balanceAfter]) => ({
      postingDate: postingDate as string,
      amount: amount as number,
      balanceAfter: balanceAfter as number | null,
    }));
    expect(printedEnding(rows)).toBe(0);
  });

  it('a row really missing still shows', () => {
    // Drop the newest row: the rows after $3,544.12 now end at $1,000.
    expect(printedEnding(wise340.slice(1))).toBe(1000);
  });

  it('null with no running balance', () => {
    expect(
      printedEnding([{ balanceAfter: null, postingDate: null }]),
    ).toBeNull();
  });
});
