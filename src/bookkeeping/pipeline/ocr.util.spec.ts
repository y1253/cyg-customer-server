import {
  chequeNumberFromOcr,
  looksLikeChequeBack,
  looksLikeChequeFront,
  looksLikeChequeText,
  ocrGate,
  ocrText,
  severalCheques,
  sideBySide,
  type OcrLine,
  type OcrResult,
} from './ocr.util';

/** One OCR line of one box at (x, y), 1000×450 image by default. */
const line = (
  text: string,
  x: number,
  y: number,
  confidence = 0.97,
  width = text.length * 12,
): OcrLine => ({
  text,
  confidence,
  boxes: [{ text, confidence, x, y, width, height: 28 }],
});

const result = (lines: OcrLine[], width = 1000, height = 450): OcrResult => ({
  text: lines.map((l) => l.text).join('\n'),
  confidence: lines.length
    ? lines.reduce((n, l) => n + l.confidence, 0) / lines.length
    : 0,
  lines,
  width,
  height,
});

/** A cheque as PaddleOCR reads it: number top-right, payee, amount, MICR at the bottom. */
const cheque = (over: Partial<Record<'payee' | 'amount', number>> = {}) =>
  result([
    line('ACME PLUMBING INC.', 30, 30),
    line('No. 001234', 860, 30),
    line('DATE 2026-03-02', 700, 90),
    line('Pay to the order of Rona Inc.', 30, 180, over.payee ?? 0.95),
    line('$ 1,450.00', 820, 180, over.amount ?? 0.96),
    line('One thousand four hundred fifty dollars', 30, 240),
    line('⑈001234⑈ ⑆12345⑉001⑆ 1234567⑈', 180, 400, 0.9),
  ]);

describe('looksLikeChequeText', () => {
  it('knows a cheque by its wording or its MICR line', () => {
    expect(looksLikeChequeText(cheque())).toBe(true);
    expect(
      looksLikeChequeText(
        result([line('⑈001234⑈ ⑆12345⑉001⑆ 1234567⑈', 180, 400)]),
      ),
    ).toBe(true);
    expect(
      looksLikeChequeText(
        result([line('Payez à l’ordre de Jean Tremblay', 30, 180)]),
      ),
    ).toBe(true);
  });

  it('a receipt is not a cheque', () => {
    expect(
      looksLikeChequeText(
        result([
          line('WALMART #1234', 30, 30),
          line('PAMPERS SZ4 23.97', 30, 80),
          line('TOTAL 26.85', 30, 130),
        ]),
      ),
    ).toBe(false);
  });
});

describe('chequeNumberFromOcr', () => {
  it('takes the top-right number, confirmed by the MICR line', () => {
    expect(chequeNumberFromOcr(cheque())).toBe('001234');
  });

  it('never takes the date or the amount', () => {
    const r = result([
      line('2026-03-02', 820, 30),
      line('$ 1,450.00', 820, 120),
      line('Pay to the order of Rona', 30, 200),
    ]);
    expect(chequeNumberFromOcr(r)).toBeNull();
  });

  it('a lone short field on the MICR line is the number when nothing is printed top-right', () => {
    const r = result([
      line('Pay to the order of Rona', 30, 200),
      line('⑈1042⑈ ⑆12345⑉001⑆ 1234567890⑈', 180, 400),
    ]);
    // "12345" (transit) is short too — two candidates, so nothing is sure.
    expect(chequeNumberFromOcr(r)).toBeNull();
    const us = result([
      line('Pay to the order of Rona', 30, 200),
      line('⑆021000021⑆ 123456789012⑈ 1042', 180, 400),
    ]);
    expect(chequeNumberFromOcr(us)).toBe('1042');
  });
});

describe('sideBySide', () => {
  it('two receipts in one photo: lines with a wide gap between their boxes', () => {
    const twoCols = (y: number): OcrLine => ({
      text: 'LEFT RIGHT',
      confidence: 0.95,
      boxes: [
        { text: 'LEFT', confidence: 0.95, x: 20, y, width: 200, height: 20 },
        { text: 'RIGHT', confidence: 0.95, x: 700, y, width: 200, height: 20 },
      ],
    });
    expect(sideBySide(result([twoCols(10), twoCols(50), twoCols(90)]))).toBe(
      true,
    );
    expect(sideBySide(result([twoCols(10)]))).toBe(false);
  });
});

describe('ocrGate — when OCR text may stand in for the file', () => {
  const receipt = result([
    line('WALMART SUPERCENTER #1234', 30, 30),
    line('PAMPERS SZ4      23.97', 30, 80),
    line('GST               1.20', 30, 130),
    line('TOTAL            26.85', 30, 180),
  ]);

  it('a receipt read surely goes as text', () => {
    expect(ocrGate(receipt)).toEqual({ ok: true, cheque: false });
  });

  it('nothing read, or too little, goes to the model', () => {
    expect(ocrGate(null)).toMatchObject({ ok: false });
    expect(ocrGate(result([line('Hi', 0, 0)]))).toMatchObject({
      ok: false,
      reason: 'too little text',
    });
  });

  it('a low overall confidence goes to the model', () => {
    const blurry = result(
      receipt.lines.map((l) => ({ ...l, confidence: 0.6 })),
    );
    expect(ocrGate(blurry)).toMatchObject({ ok: false });
  });

  it('Tesseract: a printed receipt goes as text, a cheque always to the model', () => {
    expect(ocrGate({ ...receipt, engine: 'tesseract' })).toEqual({
      ok: true,
      cheque: false,
    });
    expect(ocrGate({ ...cheque(), engine: 'tesseract' })).toEqual({
      ok: false,
      cheque: true,
      reason: 'cheque handwriting (Tesseract)',
    });
  });

  it('a cheque goes as text only with its number, amount AND payee read surely', () => {
    expect(ocrGate(cheque())).toEqual({ ok: true, cheque: true });
    expect(ocrGate(cheque({ payee: 0.7 }))).toMatchObject({
      ok: false,
      cheque: true,
      reason: 'payee not read surely',
    });
    expect(ocrGate(cheque({ amount: 0.6 }))).toMatchObject({
      ok: false,
      reason: 'cheque amount not read surely',
    });
  });
});

describe('severalCheques', () => {
  it('two cheques OCR merged into one line are several — the vision model reads them', () => {
    const merged = result([
      line('ACME INC. No. 2001 ACME INC. No. 2002', 30, 30),
      line(
        'PAY TO THE ORDER OF Bell $ 89.10 PAY TO THE ORDER OF Rona $ 12.00',
        30,
        200,
      ),
    ]);
    expect(severalCheques(merged)).toBe(true);
    expect(ocrGate(merged)).toMatchObject({
      ok: false,
      reason: 'several cheques in one image',
    });
    expect(severalCheques(cheque())).toBe(false);
  });
});

describe('looksLikeChequeBack', () => {
  it('an endorsement or a near-empty strip is a back', () => {
    expect(
      looksLikeChequeBack(
        result([
          line('ENDORSE HERE', 30, 30),
          line('For deposit only', 30, 80),
        ]),
      ),
    ).toBe(true);
    expect(looksLikeChequeBack(result([line('TD 0042', 30, 30)]))).toBe(true);
  });

  it('a cheque, or anything with an amount, is never a back', () => {
    expect(looksLikeChequeBack(cheque())).toBe(false);
    expect(
      looksLikeChequeBack(
        result([line('Deposit slip total $ 450.00 for deposit only', 30, 30)]),
      ),
    ).toBe(false);
  });

  it("a TD back is a back even with the bank's 'CHEQUE # 00021' caption on it", () => {
    expect(
      looksLikeChequeBack(
        result([
          line('CHEQUE # 00021', 30, 10),
          line('Negotiating Institution: RBC ROYAL BANK', 30, 40),
          line('Date (YYYYMMDD): 20240206', 30, 70),
          line('BACK/VERSO', 300, 160),
        ]),
      ),
    ).toBe(true);
  });
});

describe('ocrText', () => {
  it('marks the lines the model should doubt', () => {
    const t = ocrText(cheque({ payee: 0.62 }));
    expect(t).toContain('Pay to the order of Rona Inc.   [unsure 62%]');
    expect(t).toContain('$ 1,450.00');
    expect(t).not.toContain('$ 1,450.00   [unsure');
  });
});

describe('looksLikeChequeFront', () => {
  it("a cheque's wording or MICR line — never a statement's 'Cheque/Debit' header", () => {
    expect(looksLikeChequeFront(cheque())).toBe(true);
    expect(
      looksLikeChequeFront(
        result([
          line('Statement of Account  Branch No. 4240', 30, 30),
          line(
            'Description  Cheque/Debit  Deposit/Credit  Date  Balance',
            30,
            60,
          ),
          line('CHQ#00021-1144563030  2,318.08  JAN 17  12,401.55', 30, 90),
        ]),
      ),
    ).toBe(false);
  });
});
