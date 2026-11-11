import type { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import type { ChatRequest, OpenAiClient } from '../ai/openai.client';
import {
  balancesFromRunning,
  dropSpuriousPages,
  emptyReading,
  EXTRACTION_SCHEMA,
  looksLikeStatement,
  MAX_REREADS,
  parseExtraction,
  rereadRound,
  StatementExtractor,
  UnreadableStatementError,
} from './statement-extractor';

/** A blank PDF with `n` pages — the fake model doesn't look at it. */
async function pdf(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

function reply(over: Record<string, unknown>): string {
  return JSON.stringify({
    isBankStatement: true,
    bankName: 'Chase',
    accountName: 'Chase 4362',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    openingBalance: null,
    closingBalance: null,
    totalDeposits: null,
    totalWithdrawals: null,
    depositCount: null,
    withdrawalCount: null,
    totalsScope: 'none',
    transactions: [
      {
        pendingDate: null,
        postingDate: '2026-09-02',
        description: 'WALMART',
        amount: -20,
        balanceAfter: null,
        offsetAccount: 'Office Expense',
      },
    ],
    ...over,
  });
}

/** An extractor whose model answers with `answer(request, callNumber)`. */
function extractor(answer: (req: ChatRequest, n: number) => string) {
  let n = 0;
  const chat = jest.fn((req: ChatRequest) => Promise.resolve(answer(req, n++)));
  const config = { get: () => undefined } as unknown as ConfigService;
  return {
    chat,
    ex: new StatementExtractor({ chat } as unknown as OpenAiClient, config),
  };
}

const isReread = (req: ChatRequest) =>
  Array.isArray(req.user) &&
  req.user[0].type === 'text' &&
  /does NOT add up/.test(req.user[0].text);

describe('StatementExtractor re-reads', () => {
  it(`gives up after ${MAX_REREADS} re-reads when every reading is a little different but never matches`, async () => {
    // Each reading is $1 closer, so it keeps "improving" and never stops early.
    const { ex } = extractor((_req, n) =>
      reply({
        totalWithdrawals: 100,
        transactions: [
          {
            pendingDate: null,
            postingDate: '2026-09-02',
            description: 'X',
            amount: -(20 + n),
            balanceAfter: null,
            offsetAccount: 'Office Expense',
          },
        ],
      }),
    );
    const rounds: number[] = [];
    const out = await ex.extract(await pdf(1), 's.pdf', {
      onRound: (r) => {
        rounds.push(r);
      },
    });
    expect(out.verification.verification).toBe('MISMATCH');
    expect(out.rereads).toBe(MAX_REREADS);
    expect(rounds).toEqual(
      Array.from({ length: MAX_REREADS }, (_, i) => i + 1),
    );
    expect(out.calls).toBe(1 + MAX_REREADS);
  });

  it('stops early after 3 re-reads that change nothing', async () => {
    const { ex } = extractor(() => reply({ totalWithdrawals: 100 }));
    const out = await ex.extract(await pdf(1), 's.pdf');
    expect(out.verification.verification).toBe('MISMATCH');
    expect(out.rereads).toBe(3);
  });

  it('a statement with no balances is read ONCE more on the strong model, then released as UNVERIFIED', async () => {
    const { ex, chat } = extractor(() => reply({}));
    const out = await ex.extract(await pdf(2), 's.pdf');
    expect(out.verification.verification).toBe('UNVERIFIED');
    // step2 (2026-11-11): one round asking for the balances, never the MISMATCH loop.
    expect(out.rereads).toBe(1);
    expect(chat).toHaveBeenCalledTimes(4); // one per page, then each page on gpt-4.1
    expect(chat.mock.calls[2][0].model).toBe('gpt-4.1');
  });

  it('a statement whose balances were read gets no extra read', async () => {
    const { ex, chat } = extractor(() =>
      reply({ openingBalance: 0, closingBalance: 0, transactions: [] }),
    );
    const out = await ex.extract(await pdf(1), 's.pdf');
    expect(out.rereads).toBe(0);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('a strong read starts on the stronger model with the hint', async () => {
    const { ex, chat } = extractor(() => reply({}));
    await ex.extract(await pdf(1), 's.pdf', {
      strong: true,
      hint: 'The previous statement ends at $200.00.',
      maxRereads: 0,
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].model).toBe('gpt-4.1');
    expect(JSON.stringify(chat.mock.calls[0][0])).toContain(
      'The previous statement ends at $200.00.',
    );
  });

  it('a re-read that marks a total "partial" ends the loop instead of re-reading 10 times', async () => {
    const { ex } = extractor((req) =>
      isReread(req)
        ? reply({ totalWithdrawals: null, totalsScope: 'partial' })
        : reply({ totalWithdrawals: 100, totalsScope: 'all' }),
    );
    const out = await ex.extract(await pdf(1), 's.pdf');
    expect(out.verification.verification).not.toBe('MISMATCH');
    // The partial re-read, then (no balances read) the one round asking for them.
    expect(out.rereads).toBe(2);
  });

  it('escalates: suspect pages, then the stronger model, then every page', () => {
    expect(rereadRound(0)).toEqual({ verifyModel: false, allPages: false });
    expect(rereadRound(1)).toEqual({ verifyModel: true, allPages: false });
    expect(rereadRound(2)).toEqual({ verifyModel: true, allPages: true });
    expect(rereadRound(3)).toEqual({ verifyModel: true, allPages: false });
  });
});

describe('the "is this a statement?" gate (2026-10-11 BMO incident)', () => {
  const page = (over: Record<string, unknown>) => parseExtraction(reply(over));
  const empty = {
    isBankStatement: false,
    bankName: null,
    accountName: null,
    periodStart: null,
    periodEnd: null,
    transactions: [],
  };

  it('asks for the verdict LAST, after the page has been read', () => {
    expect(EXTRACTION_SCHEMA.required.at(-1)).toBe('isBankStatement');
    expect(Object.keys(EXTRACTION_SCHEMA.properties).at(-1)).toBe(
      'isBankStatement',
    );
  });

  describe('looksLikeStatement', () => {
    it('believes a yes', () => {
      expect(looksLikeStatement(page({}))).toBe(true);
    });
    it('overrules a no on a page that was read as a statement (rows + a bank)', () => {
      expect(looksLikeStatement(page({ isBankStatement: false }))).toBe(true);
    });
    it('a no with no rows stays a no', () => {
      expect(
        looksLikeStatement(page({ isBankStatement: false, transactions: [] })),
      ).toBe(false);
    });
    it('rows with nothing a statement prints stay a no (an invoice, a receipt)', () => {
      expect(
        looksLikeStatement(
          page({
            isBankStatement: false,
            bankName: null,
            accountName: null,
            periodStart: null,
          }),
        ),
      ).toBe(false);
    });
  });

  it('reads a statement gpt-4o flagged "not a statement" without any extra call', async () => {
    const { ex, chat } = extractor(() => reply({ isBankStatement: false }));
    const out = await ex.extract(await pdf(1), 'July 12, 2026.pdf');
    expect(out.transactions).toHaveLength(1);
    // Only the step2 balance read (no balances printed in the reply) — no gate retry.
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].model).toBe('gpt-4.1');
  });

  it('asks the stronger model once before giving up, and uses its reading', async () => {
    const { ex, chat } = extractor((req) =>
      req.model === 'gpt-4.1' ? reply({}) : reply(empty),
    );
    const out = await ex.extract(await pdf(1), 'scan.pdf');
    expect(out.transactions).toHaveLength(1);
    // The gate retry, then the step2 balance read.
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[1][0].model).toBe('gpt-4.1');
  });

  it('still refuses a document both models say is not a statement', async () => {
    const { ex, chat } = extractor(() => reply(empty));
    await expect(ex.extract(await pdf(1), 'invoice.pdf')).rejects.toThrow(
      UnreadableStatementError,
    );
    await expect(
      extractor(() => reply(empty)).ex.extract(await pdf(1), 'invoice.pdf'),
    ).rejects.toThrow(
      'This file does not look like a bank or credit-card statement.',
    );
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

describe('dropSpuriousPages', () => {
  const row = (amount: number, balanceAfter: number | null = null) => ({
    pendingDate: null,
    postingDate: '2026-02-01',
    description: 'x',
    amount,
    balanceAfter,
    offsetAccount: 'Uncategorized',
  });
  const page = (
    transactions: ReturnType<typeof row>[],
    stated: Partial<ReturnType<typeof emptyReading>['stated']> = {},
  ) => {
    const p = emptyReading();
    return {
      ...p,
      isBankStatement: true,
      stated: { ...p.stated, ...stated },
      transactions,
    };
  };

  it('Chase card: the summary line read as a row on page 1 is left out', () => {
    // 2026-10-28, Madam recovery #292: "Payment, Credits −852.58" on the summary page was
    // read as a row beside the real payment on page 3 — deposits exactly doubled.
    const summary = page([row(852.58)], {
      totalDeposits: 852.58,
      totalWithdrawals: 1054.04,
    });
    const activity = page([row(852.58), row(-976.56), row(-77.48)]);
    const out = dropSpuriousPages([summary, activity]);
    expect(out?.pages).toEqual([0]);
    expect(out?.result.verification.verification).toBe('VERIFIED');
  });

  it('never drops a page when that is not what makes it add up', () => {
    const p1 = page([row(10)], { totalDeposits: 25 });
    const p2 = page([row(10)]);
    expect(dropSpuriousPages([p1, p2])).toBeNull();
  });

  it('TD: never drops a page whose own Credits/Debits box matches its rows (#574)', () => {
    // A bad running balance on page 3 — emptying pages 2 and 3 used to "add up", because a
    // page with no rows has its box taken for a summary.
    const p1 = page([row(100, 100), row(-30, 70)], {
      openingBalance: 0,
      totalDeposits: 100,
      totalWithdrawals: 30,
    });
    const p2 = page([row(50, 120), row(-20, 100)], {
      totalDeposits: 50,
      totalWithdrawals: 20,
    });
    const p3 = page([row(-10, 93), row(5, 95)], {
      totalDeposits: 5,
      totalWithdrawals: 10,
    });
    expect(dropSpuriousPages([p1, p2, p3])).toBeNull();
  });
});

describe('balancesFromRunning (TD prints no closing line, 2026-11-11)', () => {
  const r = (amount: number, balanceAfter: number | null, postingDate = '2024-02-01') => ({
    amount,
    balanceAfter,
    postingDate,
  });
  const ok = {
    verification: 'VERIFIED' as const,
    balanceSign: 1 as const,
    checks: [
      { name: 'runningBalance' as const, expected: 3, actual: 3, ok: true, skipped: null },
    ],
  };
  // 2-2024.pdf page 1: BALANCE FORWARD 608.42OD, then 7 rows to 520.28 …
  const td = [
    r(-40, null),
    r(3000, null),
    r(200, null),
    r(23, null),
    r(-825.35, null),
    r(-1200, null),
    r(-28.95, 520.28),
    r(1800, null, '2024-02-29'),
    r(-4081.28, -1761.0, '2024-02-29'),
  ];

  it('opening = first printed balance less the rows to it; closing = the last row', () => {
    expect(balancesFromRunning(td, ok)).toEqual({ opening: -608.42, closing: -1761 });
  });

  it('newest-first statements read from the other end', () => {
    expect(balancesFromRunning([...td].reverse(), ok)).toEqual({
      opening: -608.42,
      closing: -1761,
    });
  });

  it('no closing when the last row prints no balance', () => {
    expect(balancesFromRunning([...td, r(-5, null, '2024-02-29')], ok)?.closing).toBeNull();
  });

  it('nothing unless the reading is VERIFIED with a passing running balance', () => {
    expect(balancesFromRunning(td, { ...ok, verification: 'UNVERIFIED' })).toBeNull();
    expect(
      balancesFromRunning(td, {
        ...ok,
        checks: [{ ...ok.checks[0], actual: 2, ok: false }],
      }),
    ).toBeNull();
  });
});
