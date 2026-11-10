import {
  MAX_DOCUMENTS_PER_FILE,
  cleanReadings,
  isPaymentDocument,
  isRefusal,
} from './attachment-extractor';

describe('isRefusal (step2d)', () => {
  it("spots the vision model's short refusals", () => {
    expect(isRefusal("I'm sorry, I can't assist with that.")).toBe(true);
    expect(isRefusal('I’m sorry, but I cannot help with this request.')).toBe(
      true,
    );
    expect(isRefusal('Sorry, I am unable to read this image.')).toBe(true);
  });

  it('never takes a reading for a refusal', () => {
    expect(
      isRefusal(
        'The message says: "איך וויל זאלסט מיר טעקסטען" — "I want you to text me".',
      ),
    ).toBe(false);
    expect(
      isRefusal(
        "Sorry I'm late, can't make it today — see you tomorrow. (Translation of the text message.)".repeat(
          2,
        ),
      ),
    ).toBe(false);
  });
});

const doc = (extra: Record<string, unknown>) => ({
  documentType: 'CHECK',
  summary: 'Cheque',
  kind: 'CHECK',
  vendor: null,
  date: '2026-10-01',
  subtotal: null,
  tax: null,
  total: 100,
  items: [],
  checkNumber: '12',
  payee: 'Rona',
  memo: null,
  category: null,
  ...extra,
});

describe('cleanReadings (step11b)', () => {
  it('keeps every document of one file separate — two cheques are two readings', () => {
    const out = cleanReadings({
      documents: [doc({ total: 100 }), doc({ total: 250, checkNumber: '13' })],
    });
    expect(out.map((r) => r.total)).toEqual([100, 250]);
    expect(out.map((r) => r.checkNumber)).toEqual(['12', '13']);
  });

  it('never loses a file: an empty list or an old single object still gives one reading', () => {
    expect(cleanReadings({ documents: [] })).toHaveLength(1);
    expect(cleanReadings(doc({}))[0].total).toBe(100);
  });

  it("keeps a DOCUMENT's own words, in its own script — never a payment's (step2d)", () => {
    const words = 'Me: שלום, קענסטו מיר שיקן די רעכענונג?';
    const [letter, cheque] = cleanReadings({
      documents: [
        doc({ documentType: 'DOCUMENT', text: `  ${words}  ` }),
        doc({ text: 'Pay to the order of Rona' }),
      ],
    });
    expect(letter.text).toBe(words);
    expect(cheque.text).toBeUndefined();
    expect(cleanReadings(doc({ documentType: 'DOCUMENT', text: '' }))[0]).not.toHaveProperty('text');
  });

  it('caps the number of documents', () => {
    const many = Array.from({ length: 30 }, () => doc({}));
    expect(cleanReadings({ documents: many })).toHaveLength(
      MAX_DOCUMENTS_PER_FILE,
    );
  });

  it('derives the old kind from the document type', () => {
    const [invoice, letter] = cleanReadings({
      documents: [
        doc({ documentType: 'INVOICE', kind: 'OTHER' }),
        doc({ documentType: 'DOCUMENT', kind: 'RECEIPT' }),
      ],
    });
    expect(invoice.kind).toBe('RECEIPT');
    expect(letter.kind).toBe('OTHER');
    expect(letter.documentType).toBe('DOCUMENT');
  });

  it('matches payments only', () => {
    expect(isPaymentDocument('CHECK')).toBe(true);
    expect(isPaymentDocument('DEPOSIT_SLIP')).toBe(true);
    expect(isPaymentDocument(undefined)).toBe(true); // a reading from before step11b
    expect(isPaymentDocument('DOCUMENT')).toBe(false);
    expect(isPaymentDocument('BANK_STATEMENT')).toBe(false);
  });
});
