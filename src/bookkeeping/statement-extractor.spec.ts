import type { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import type { ChatRequest, OpenAiClient } from '../ai/openai.client';
import {
  MAX_REREADS,
  rereadRound,
  StatementExtractor,
} from './statement-extractor';
import { needsReviewMessage } from './statement-processor.service';

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

  it('a statement with no totals is released as UNVERIFIED without a single re-read', async () => {
    const { ex, chat } = extractor(() => reply({}));
    const out = await ex.extract(await pdf(2), 's.pdf');
    expect(out.verification.verification).toBe('UNVERIFIED');
    expect(out.rereads).toBe(0);
    expect(chat).toHaveBeenCalledTimes(2); // one per page
  });

  it('a re-read that marks a total "partial" ends the loop instead of re-reading 10 times', async () => {
    const { ex } = extractor((req) =>
      isReread(req)
        ? reply({ totalWithdrawals: null, totalsScope: 'partial' })
        : reply({ totalWithdrawals: 100, totalsScope: 'all' }),
    );
    const out = await ex.extract(await pdf(1), 's.pdf');
    expect(out.verification.verification).not.toBe('MISMATCH');
    expect(out.rereads).toBe(1);
  });

  it('escalates: suspect pages, then the stronger model, then every page', () => {
    expect(rereadRound(0)).toEqual({ verifyModel: false, allPages: false });
    expect(rereadRound(1)).toEqual({ verifyModel: true, allPages: false });
    expect(rereadRound(2)).toEqual({ verifyModel: true, allPages: true });
    expect(rereadRound(3)).toEqual({ verifyModel: true, allPages: false });
  });
});

describe('needsReviewMessage', () => {
  it('says how many times it was checked and exactly what is off', () => {
    expect(
      needsReviewMessage(10, [
        'Withdrawals: statement $4,812.40, read $4,728.03 (off by $84.37)',
      ]),
    ).toBe(
      "We re-checked this statement 10 times and it still doesn't match the bank's totals " +
        '(Withdrawals: statement $4,812.40, read $4,728.03 (off by $84.37)). ' +
        "Nothing from it is in your ledger. Try again, or contact us and we'll look at it.",
    );
  });
});
