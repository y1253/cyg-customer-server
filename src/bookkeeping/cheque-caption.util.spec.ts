import { chequeNumberOf, dropChequeCaptions } from './cheque-caption.util';

const row = (description: string, amount: number) => ({ description, amount });

describe('chequeNumberOf', () => {
  it.each([
    ['CHQ#00034-0142429574', '34'],
    ['CHEQUE # 00034', '34'],
    ['Cheque 1042', '1042'],
    ['CHECK NO. 55', '55'],
    ['CHK 0007 RETURNED', '7'],
  ])('%s → %s', (d, n) => expect(chequeNumberOf(d)).toBe(n));

  it('no cheque word, no number', () => {
    expect(chequeNumberOf('TFR-FR 7308273')).toBeNull();
    expect(chequeNumberOf('CHECKOUT.COM 1234')).toBeNull();
  });
});

describe('dropChequeCaptions', () => {
  // The real #553 shape: rows on pages 1–3, the cheque images (and their captions) on 4–5.
  const pages = [
    {
      hasItemImages: false,
      transactions: [row('CHQ#00034-0142429574', -983.28), row('UBER', -10)],
    },
    { hasItemImages: false, transactions: [row('CHQ#00036-1144625196', -825)] },
    {
      hasItemImages: true,
      transactions: [
        row('CHEQUE # 00034', -983.28),
        row('CHEQUE # 00036', -825),
      ],
    },
  ];

  it('drops the captions of cheques listed earlier', () => {
    const r = dropChequeCaptions(pages);
    expect(r.dropped).toBe(2);
    expect(r.pages[2].transactions).toEqual([]);
    expect(r.pages[0]).toBe(pages[0]);
  });

  it('keeps a cheque row on an image page when it is the only one', () => {
    const only = [
      { hasItemImages: true, transactions: [row('CHEQUE # 00099', -50)] },
    ];
    expect(dropChequeCaptions(only).dropped).toBe(0);
  });

  it('keeps a same-number row with a different amount (not a caption)', () => {
    const r = dropChequeCaptions([
      pages[0],
      { hasItemImages: true, transactions: [row('CHEQUE # 00034', -98.32)] },
    ]);
    expect(r.dropped).toBe(0);
  });

  it('never drops on a page without item images', () => {
    const r = dropChequeCaptions([
      pages[0],
      { hasItemImages: false, transactions: [row('CHEQUE # 00034', -983.28)] },
    ]);
    expect(r.dropped).toBe(0);
  });
});
