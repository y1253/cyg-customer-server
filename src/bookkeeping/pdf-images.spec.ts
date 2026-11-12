import {
  captionOver,
  isBackground,
  itemBoxes,
  parseCaption,
  placeItems,
  readingOrder,
  type Box,
  type TextLine,
} from './pdf-images';

// mupdf itself (ESM + WASM) is exercised by `scripts/bookkeeping-probe.ts --image-pages=`.
const LETTER: Box = [0, 0, 612, 792];

describe('itemBoxes', () => {
  it('keeps cheque-sized images top to bottom, and drops logos and icons', () => {
    const chequeA: Box = [36, 400, 576, 640];
    const chequeB: Box = [36, 100, 576, 340];
    const logo: Box = [36, 20, 136, 60];
    const icon: Box = [500, 700, 560, 760];
    expect(itemBoxes([chequeA, logo, chequeB, icon], LETTER)).toEqual([
      chequeB,
      chequeA,
    ]);
  });

  it('keeps two cheques side by side, left first', () => {
    const left: Box = [20, 100, 300, 230];
    const right: Box = [310, 100, 590, 230];
    expect(itemBoxes([right, left], LETTER)).toEqual([left, right]);
  });

  it('counts an image with its mask or a stamp over it once', () => {
    const scan: Box = [36, 100, 576, 340];
    const stamp: Box = [300, 120, 500, 200];
    const mask: Box = [36, 101, 576, 339];
    expect(itemBoxes([stamp, scan, mask], LETTER)).toEqual([scan]);
  });

  it('clips an image bleeding off the page', () => {
    expect(itemBoxes([[-20, 700, 640, 900]], LETTER)).toEqual([
      [0, 700, 612, 792],
    ]);
  });

  it('finds nothing on a page of text', () => {
    expect(itemBoxes([], LETTER)).toEqual([]);
  });
});

// step2 (2026-11-12): TD 4496 page 4 as mupdf lists it — a full-page background and, on it,
// each cheque's front and back as separate sharp images, captioned in the text layer.
describe('TD cheque pages', () => {
  const background: Box = [0, 0, 612, 792];
  const front: Box = [58, 137, 292, 234];
  const back: Box = [320, 137.2, 554, 233];
  const front2: Box = [58, 284, 292, 378];
  const back2: Box = [320, 284, 554, 378];
  const lines: TextLine[] = [
    { box: [58, 118, 140, 127], text: '4240-5234496' },
    { box: [58, 127, 160, 136], text: 'CHEQUE # 00021' },
    { box: [262, 127, 292, 136], text: '$2,318.08' },
    { box: [320, 127, 420, 136], text: 'CHEQUE # 00021' },
    { box: [58, 274, 160, 283], text: 'CHEQUE # 00031 $575.58' },
    { box: [320, 274, 420, 283], text: 'CHEQUE # 00031' },
  ];

  it('drops the page background when cheque images are placed on it', () => {
    expect(itemBoxes([background, back, front], LETTER)).toEqual([front, back]);
  });

  it('keeps the background alone as the page (a flattened scan)', () => {
    expect(itemBoxes([background], LETTER)).toEqual([background]);
    expect(isBackground(background, LETTER)).toBe(true);
    expect(isBackground(front, LETTER)).toBe(false);
  });

  it('reads the caption over each image', () => {
    expect(captionOver(front, lines)?.text).toBe('CHEQUE # 00021 $2,318.08');
    expect(parseCaption('CHEQUE # 00021 $2,318.08')).toEqual({
      text: 'CHEQUE # 00021 $2,318.08',
      number: '00021',
      amount: 2318.08,
    });
    expect(parseCaption('CHEQUE # 00021').amount).toBeNull();
    expect(captionOver([58, 500, 292, 600], lines)).toBeNull();
  });

  it('makes a front and its back ONE item, caption included', () => {
    const items = placeItems(
      itemBoxes([background, front, back, front2, back2], LETTER),
      lines,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      box: [58, 127, 554, 234],
      caption: {
        text: 'CHEQUE # 00021 $2,318.08',
        number: '00021',
        amount: 2318.08,
      },
      withBack: true,
    });
    expect(items[1].caption?.number).toBe('00031');
    expect(items[1].withBack).toBe(true);
  });

  it('never joins two fronts side by side', () => {
    const twoFronts: TextLine[] = [
      { box: [58, 127, 220, 136], text: 'CHEQUE # 00021 $2,318.08' },
      { box: [320, 127, 480, 136], text: 'CHEQUE # 00022 $10.00' },
    ];
    const items = placeItems([front, back], twoFronts);
    expect(items.map((i) => i.withBack)).toEqual([false, false]);
  });

  it('reads a row left to right even when the back sits a hair higher', () => {
    expect(readingOrder([back, front])).toEqual([front, back]);
  });
});
