// mupdf (ESM + WASM) does not load under jest here — `chequeRegions` is checked by
// `scripts/bookkeeping-probe.ts --cheques`.
import { splitRegions, type PixelBox } from './cheque-split';

/** An ink map with these rectangles filled (a scanned cheque is "paper" all over). */
function inkMap(
  width: number,
  height: number,
  boxes: PixelBox[],
  /** White bands INSIDE the boxes (the space between a cheque's printed lines). */
  holes: PixelBox[] = [],
): Uint8Array {
  const ink = new Uint8Array(width * height);
  for (const b of boxes)
    for (let y = b.y0; y < b.y1; y++)
      for (let x = b.x0; x < b.x1; x++) ink[y * width + x] = 1;
  for (const b of holes)
    for (let y = b.y0; y < b.y1; y++)
      for (let x = b.x0; x < b.x1; x++) ink[y * width + x] = 0;
  return ink;
}

const box = (x0: number, y0: number, x1: number, y1: number): PixelBox => ({
  x0,
  y0,
  x1,
  y1,
});

describe('splitRegions — cheques cut apart by code', () => {
  it('two cheques side by side', () => {
    const a = box(10, 20, 450, 220);
    const b = box(480, 20, 920, 220);
    expect(splitRegions(inkMap(940, 240, [a, b]), 940, 240)).toEqual([a, b]);
  });

  it('two cheques stacked (a statement page)', () => {
    const a = box(40, 30, 760, 340);
    const b = box(40, 380, 760, 690);
    expect(splitRegions(inkMap(800, 720, [a, b]), 800, 720)).toEqual([a, b]);
  });

  it('a 2×2 grid of cheques, read top to bottom then left to right', () => {
    const cheques = [
      box(10, 10, 450, 210),
      box(480, 10, 920, 210),
      box(10, 240, 450, 440),
      box(480, 240, 920, 440),
    ];
    expect(splitRegions(inkMap(930, 450, cheques), 930, 450)).toEqual(cheques);
  });

  it('never cuts ONE cheque along the white space between its lines', () => {
    const one = box(20, 20, 920, 420);
    const holes = [box(20, 120, 920, 150), box(20, 260, 920, 300)];
    expect(splitRegions(inkMap(940, 440, [one], holes), 940, 440)).toEqual([]);
  });

  it("keeps a statement's header line with the first cheque, never as a cheque of its own", () => {
    // Dropping a small strip would also drop a white cheque's own MICR line; the header
    // costs only a few pixels of text above the first crop.
    const header = box(40, 10, 400, 24);
    const a = box(40, 60, 760, 360);
    const b = box(40, 400, 760, 700);
    expect(splitRegions(inkMap(800, 720, [header, a, b]), 800, 720)).toEqual([
      { ...a, y0: 10 },
      b,
    ]);
  });

  it('one cheque, or nothing, is not a split', () => {
    expect(
      splitRegions(inkMap(500, 220, [box(10, 10, 490, 210)]), 500, 220),
    ).toEqual([]);
    expect(splitRegions(new Uint8Array(100 * 100), 100, 100)).toEqual([]);
  });

  it('a front and its back side by side are two regions (OCR drops the back later)', () => {
    const front = box(10, 20, 450, 220);
    const back = box(480, 20, 920, 220);
    expect(
      splitRegions(inkMap(940, 240, [front, back]), 940, 240),
    ).toHaveLength(2);
  });
});
