import type { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import type { ChatRequest, OpenAiClient } from '../ai/openai.client';
import { listStatements } from '../assistant/statement-list.util';
import { statementDoneNote } from '../voice/voice-session';
import { balanceFit, withBalanceCheck } from './bookkeeping.service';
import { pageContents } from './page-content.util';
import { reconcile, reconcileStatement } from './reconcile.util';
import { pdfPageTexts, printedBalanceLines } from './pipeline/pdf-text';
import { missingBalances, StatementExtractor } from './statement-extractor';
import { customerBalances } from './statement-processor.service';

// mupdf (ESM + WASM) does not load under jest: the PDF's text and contents are mocked.
jest.mock('./pipeline/pdf-text', () => ({
  ...jest.requireActual<object>('./pipeline/pdf-text'),
  pdfPageTexts: jest.fn(),
}));
jest.mock('./page-content.util', () => ({
  ...jest.requireActual<object>('./page-content.util'),
  pageContents: jest.fn(),
}));

const texts = pdfPageTexts as jest.MockedFunction<typeof pdfPageTexts>;
const contents = pageContents as jest.MockedFunction<typeof pageContents>;

/** Page 1 of Madam recovery's Chase 4148 statement #280, as its text layer prints it. */
const CHASE_PAGE = [
  '                                            New Balance',
  '             September  2025                         CHASE FREEDOM UNLIMITED',
  '                                            $2,629.30',
  '     31    1    2    3          Previous points balance                  4,586',
  '   ACCOUNT SUMMARY ACCOUNT SUMMARY',
  '   Account Number:  XXXX XXXX XXXX 0361',
  '   Previous Balance                                         $633.66',
  '   Payment, Credits                                      -$1,213.66',
  '   Purchases                                             +$3,209.30',
  '   New Balance                                            $2,629.30',
  '   Opening/Closing Date                          07/21/25 - 08/20/25',
  '   chase.com/paycard             New Balance:                   $2,629.30',
].join('\n');

describe('2026-11-11: balances a statement prints are never silently left unread', () => {
  it('printedBalanceLines finds labelled balances WITH an amount, nothing else', () => {
    expect(printedBalanceLines(CHASE_PAGE)).toEqual({
      opening: ['Previous Balance $633.66'],
      closing: ['New Balance $2,629.30', 'New Balance: $2,629.30'],
    });
    expect(
      printedBalanceLines('Feb 01   Opening balance        100.00'),
    ).toEqual({
      opening: ['Opening balance 100.00'],
      closing: [],
    });
    expect(
      printedBalanceLines('Previous points balance 4,586\nNew Balance'),
    ).toEqual({
      opening: [],
      closing: [],
    });
  });

  it('missingBalances: the printed lines whose figure was read as null, and their pages', () => {
    const printed = [
      printedBalanceLines(CHASE_PAGE),
      { opening: [], closing: [] },
    ];
    expect(
      missingBalances(
        { openingBalance: 633.66, closingBalance: null },
        printed,
      ),
    ).toEqual({
      lines: ['New Balance $2,629.30', 'New Balance: $2,629.30'],
      pages: [0],
    });
    expect(
      missingBalances(
        { openingBalance: 633.66, closingBalance: 2629.3 },
        printed,
      ),
    ).toEqual({ lines: [], pages: [] });
  });
});

describe('StatementExtractor asks again for a printed balance it did not read', () => {
  async function pdf(n: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage();
    return Buffer.from(await doc.save());
  }
  const config = (env: Record<string, string> = {}) =>
    ({ get: (k: string) => env[k] }) as unknown as ConfigService;
  const row = (description: string, amount: number) => ({
    pendingDate: null,
    postingDate: '2025-08-01',
    description,
    name: null,
    amount,
    balanceAfter: null,
    offsetAccount: 'Uncategorized',
  });
  const reading = (over: Record<string, unknown>) =>
    JSON.stringify({
      isBankStatement: true,
      bankName: 'Chase',
      accountName: 'Chase 0361',
      accountKind: 'CREDIT_CARD',
      periodStart: '2025-07-21',
      periodEnd: '2025-08-20',
      openingBalance: null,
      closingBalance: null,
      totalDeposits: null,
      totalWithdrawals: null,
      depositCount: null,
      withdrawalCount: null,
      totalsScope: 'none',
      hasItemImages: false,
      transactions: [row('PAYMENT THANK YOU', 1213.66), row('AMAZON', -3209.3)],
      ...over,
    });
  const extractor = (replies: string[]) => {
    const chat = jest.fn<Promise<string>, [ChatRequest]>(() =>
      Promise.resolve(replies.length > 1 ? replies.shift()! : replies[0]),
    );
    const ex = new StatementExtractor(
      { chat } as unknown as OpenAiClient,
      config({ STATEMENT_TEXT_PIPELINE: '1' }),
    );
    return { ex, chat };
  };

  beforeEach(() => {
    texts.mockReset().mockResolvedValue([CHASE_PAGE]);
    contents
      .mockReset()
      .mockResolvedValue([
        { text: CHASE_PAGE, images: [], bounds: [0, 0, 612, 792] },
      ]);
  });

  it('#280: opening + totals read, closing not → re-read names the printed line and keeps the closing', async () => {
    const totals = {
      openingBalance: 633.66,
      totalDeposits: 1213.66,
      totalWithdrawals: 3209.3,
      totalsScope: 'all',
    };
    const { ex, chat } = extractor([
      reading(totals),
      reading({ ...totals, closingBalance: 2629.3 }),
    ]);
    const out = await ex.extract(await pdf(1), '20250820-statements-4148-.pdf');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(chat.mock.calls[1][0].user)).toContain(
      'New Balance $2,629.30',
    );
    expect(out.stated.closingBalance).toBe(2629.3);
    expect(out.verification.verification).toBe('VERIFIED');
  });

  it('nothing printed was read, even when asked again → set aside (MISMATCH), never released unchecked', async () => {
    const { ex, chat } = extractor([reading({})]);
    const out = await ex.extract(await pdf(1), '20251220-statements-4148-.pdf');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(out.verification.verification).toBe('MISMATCH');
    const check = out.verification.checks.find(
      (c) => c.name === 'printedFigures',
    );
    expect(check).toMatchObject({ ok: false, skipped: null });
    expect(check?.printed).toContain('Previous Balance $633.66');
  });

  it('a page that prints no balance stays UNVERIFIED with no extra call', async () => {
    const plain = 'Wise   EUR statement   1 May - 31 Dec 2025\n'.repeat(3);
    texts.mockResolvedValue([plain]);
    contents.mockResolvedValue([
      { text: plain, images: [], bounds: [0, 0, 612, 792] },
    ]);
    const { ex, chat } = extractor([reading({})]);
    const out = await ex.extract(await pdf(1), 'wise.pdf');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(out.verification.verification).toBe('UNVERIFIED');
  });
});

describe('the balances a customer set survive a re-read', () => {
  it('customerBalances reads the LAST figures setBalances wrote', () => {
    const note = [
      'The statement ending August 20, 2025 says New Balance 2629.30.',
      'The closing balance is 3960.99 (customer: it says 3,960.99)',
      'The opening balance is 0.00 and closing balance is 3411.37 (customer: "the opening balance is 1.00")',
    ].join('\n');
    expect(customerBalances(note)).toEqual({ opening: 0, closing: 3411.37 });
    expect(
      customerBalances('The closing balance is not printed (customer: x)'),
    ).toEqual({
      opening: null,
      closing: null,
    });
    expect(customerBalances(null)).toEqual({ opening: null, closing: null });
  });
});

describe('set_statement_balances re-judges the stored ending-balance check', () => {
  const stored = [
    { name: 'deposits', ok: true, text: 'Deposits $1,000.00 ✓' },
    {
      name: 'balance',
      ok: true,
      expected: 90516,
      actual: 90516,
      text: 'Ending balance $905.16 ✓',
    },
    { name: 'deposits', ok: true, page: 1, text: 'Page 2 — Deposits ✓' },
  ];

  it('#317: an opening of 0 the statement does not print fails its tick', () => {
    const fit = balanceFit(0, 905.16, 805.16, false);
    const out = withBalanceCheck(stored, fit, 905.16) as Array<
      Record<string, unknown>
    >;
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({
      name: 'balance',
      ok: false,
      expected: 90516,
      actual: 80516,
    });
    expect(String(out[2].text)).toContain('off by $100.00');
  });

  it('the printed opening (100.00) passes; a missing balance drops the check', () => {
    const fit = balanceFit(100, 905.16, 805.16, false);
    expect(
      (withBalanceCheck(stored, fit, 905.16) as Array<{ ok: boolean }>)[2].ok,
    ).toBe(true);
    const none = balanceFit(null, 905.16, 805.16, false);
    expect(withBalanceCheck(stored, none, 905.16)).toHaveLength(2);
  });
});

describe('the AI is told the truth about a re-read statement', () => {
  const row = { status: 'DONE', error: null, filename: 's.pdf' };

  it('only a VERIFIED statement "matches the bank"', () => {
    expect(
      statementDoneNote(280, {
        ...row,
        verification: 'VERIFIED',
        openingBalance: 633.66,
        closingBalance: 2629.3,
      }),
    ).toContain(
      "matches the bank's own figures (opening $633.66, closing $2629.30)",
    );
    const unchecked = statementDoneNote(280, {
      ...row,
      verification: 'UNVERIFIED',
      openingBalance: 633.66,
      closingBalance: null,
    });
    expect(unchecked).toContain('could NOT be checked');
    expect(unchecked).toContain('closing not read');
    expect(unchecked).not.toContain('matches the bank');
  });

  it("list_statements shows each statement's balances and verification", () => {
    const out = listStatements([
      {
        id: 280,
        label: 'Chase 4148 · Aug 2025',
        status: 'DONE',
        accountName: 'Chase 4148',
        periodStart: '2025-07-21',
        periodEnd: '2025-08-20',
        transactionCount: 35,
        error: null,
        createdAt: '2026-10-27',
        openingBalance: 633.66,
        closingBalance: null,
        verification: 'UNVERIFIED',
      },
    ]);
    expect(out.statements[0]).toMatchObject({
      openingBalance: 633.66,
      closingBalance: null,
      verification: 'UNVERIFIED',
    });
  });
});

describe('a card read with every sign flipped is not VERIFIED (#288, 2026-11-11)', () => {
  // Chase 4148 Dec 2025: Previous 3,618.57 − payments 225.09 + purchases 25.00 + interest
  // 80.39 = New 3,498.87 (owed).
  const stated = {
    openingBalance: 3618.57,
    closingBalance: 3498.87,
    totalDeposits: 225.09,
    totalWithdrawals: 105.39,
    depositCount: null,
    withdrawalCount: null,
    totalsScope: 'all' as const,
  };
  const rows = (amounts: number[]) =>
    amounts.map((amount) => ({ amount, balanceAfter: null, page: 0 }));

  it('flipped rows: the bank figures only add up as a card, so the totals are compared → MISMATCH', () => {
    const r = reconcile(stated, rows([-225.09, 25, 80.39]));
    expect(r.balanceSign).toBe(-1);
    expect(r.verification).toBe('MISMATCH');
    expect(r.checks.find((c) => c.name === 'deposits')).toMatchObject({
      ok: false,
      skipped: null,
    });
  });

  it('rows read right: VERIFIED as a card', () => {
    const r = reconcile(stated, rows([225.09, -25, -80.39]));
    expect(r.balanceSign).toBe(-1);
    expect(r.verification).toBe('VERIFIED');
  });
});

describe('a summary page with no rows is not a per-page totals box (#288, 2026-11-11)', () => {
  const none = {
    openingBalance: null,
    closingBalance: null,
    totalDeposits: null,
    totalWithdrawals: null,
    depositCount: null,
    withdrawalCount: null,
    totalsScope: null,
  };
  const summary = {
    ...none,
    openingBalance: 3618.57,
    closingBalance: 3498.87,
    totalDeposits: 225.09,
    totalWithdrawals: 105.39,
    totalsScope: 'all' as const,
  };
  const row = (amount: number, page: number) => ({
    amount,
    balanceAfter: null,
    page,
  });

  it('page 1 summary + page 3 partial subtotal → the whole statement is checked, VERIFIED', () => {
    const r = reconcileStatement(summary, [
      { stated: summary, rows: [] },
      { stated: none, rows: [row(225.09, 1), row(-25, 1)] },
      {
        stated: { ...none, totalWithdrawals: 80.39, totalsScope: 'partial' },
        rows: [row(-80.39, 2)],
      },
    ]);
    expect(r.verification).toBe('VERIFIED');
    expect(r.checks.every((c) => c.page === undefined)).toBe(true);
  });

  it('pages that each have rows and their own box are still checked per page (TD)', () => {
    const box = (dep: number) => ({
      ...none,
      totalDeposits: dep,
      totalsScope: 'all' as const,
    });
    const r = reconcileStatement(box(100), [
      { stated: box(100), rows: [row(100, 0)] },
      { stated: box(50), rows: [row(50, 1)] },
    ]);
    expect(r.checks.filter((c) => c.page !== undefined)).toHaveLength(2);
  });
});
