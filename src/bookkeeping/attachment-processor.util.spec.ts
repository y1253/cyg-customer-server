import { classOf, readingTotal } from './attachment-processor.service';

describe('attachment class and total', () => {
  it('reads a text message as text, audio as audio, a PDF as a PDF, the rest as images', () => {
    expect(classOf('text/plain')).toBe('text');
    expect(classOf('text/plain; charset=utf-8')).toBe('text');
    expect(classOf('audio/mp4')).toBe('audio');
    expect(classOf('application/pdf')).toBe('pdf');
    expect(classOf('image/jpeg')).toBe('image');
  });

  it('takes the total, else subtotal + tax, else the items + tax', () => {
    const base = {
      kind: 'RECEIPT' as const,
      vendor: null,
      date: null,
      checkNumber: null,
      payee: null,
      memo: null,
    };
    expect(
      readingTotal({ ...base, subtotal: 40, tax: 5, total: 46, items: [] }),
    ).toBe(46);
    expect(
      readingTotal({ ...base, subtotal: 40, tax: 5, total: null, items: [] }),
    ).toBe(45);
    expect(
      readingTotal({
        ...base,
        subtotal: null,
        tax: 1.5,
        total: null,
        items: [
          { name: 'Tissues', amount: 10 },
          { name: 'Pampers', amount: 20 },
        ],
      }),
    ).toBe(31.5);
  });
});
