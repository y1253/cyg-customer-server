import { itemBoxes, type Box } from './pdf-images';

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
