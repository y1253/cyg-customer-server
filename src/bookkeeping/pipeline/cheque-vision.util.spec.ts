import {
  backColumn,
  chequeRects,
  cutBox,
  inReadingOrder,
  pairBacks,
  type PxRect,
} from './cheque-vision.util';

// OpenCV and mupdf themselves are exercised by `scripts/bookkeeping-probe.ts --cv`.
// A TD cheque page as OpenCV sees it at 918 × 1188: 4 rows of front | back, each frame
// traced twice (its border's outer and inner edge).
const W = 918;
const H = 1188;
const row = (y: number): PxRect[] => [
  { x: 84, y, w: 354, h: 165 },
  { x: 86, y: y + 11, w: 351, h: 152 },
  { x: 478, y, w: 355, h: 166 },
  { x: 480, y: y + 11, w: 351, h: 152 },
];
const page = [...row(192), ...row(413), ...row(645), ...row(854)];

describe('chequeRects', () => {
  it("keeps one rectangle per frame (the border's outer edge)", () => {
    const found = inReadingOrder(chequeRects(page, W, H));
    expect(found).toHaveLength(8);
    expect(found[0]).toEqual({ x: 84, y: 192, w: 354, h: 165 });
    expect(found[1]).toEqual({ x: 478, y: 192, w: 355, h: 166 });
  });

  it('drops the sheet two cheques sit on, and a box inside one cheque', () => {
    const a: PxRect = { x: 10, y: 10, w: 400, h: 170 };
    const b: PxRect = { x: 10, y: 200, w: 400, h: 170 };
    const sheet: PxRect = { x: 0, y: 0, w: 420, h: 380 }; // aspect 1.1 — and holds two
    const amountBox: PxRect = { x: 300, y: 60, w: 90, h: 30 }; // too small
    const wideSheet: PxRect = { x: 0, y: 0, w: 900, h: 380 }; // cheque-shaped, holds two
    const c: PxRect = { x: 450, y: 10, w: 400, h: 170 };
    expect(
      chequeRects([a, b, sheet, amountBox], 1000, 1000).sort(
        (p, q) => p.y - q.y,
      ),
    ).toEqual([a, b]);
    expect(
      chequeRects([wideSheet, a, c], 1000, 1000).sort((p, q) => p.x - q.x),
    ).toEqual([a, c]);
  });

  it('refuses shapes that are not cheques', () => {
    const strip: PxRect = { x: 0, y: 0, w: 900, h: 40 }; // a line of text
    const square: PxRect = { x: 0, y: 0, w: 300, h: 300 };
    const whole: PxRect = { x: 0, y: 0, w: 1000, h: 420 }; // the whole image
    expect(chequeRects([strip, square, whole], 1000, 420)).toEqual([]);
  });
});

describe('inReadingOrder', () => {
  it('reads a row left to right even when the back sits a pixel higher', () => {
    const front: PxRect = { x: 85, y: 205, w: 350, h: 150 };
    const back: PxRect = { x: 480, y: 204, w: 350, h: 150 };
    const next: PxRect = { x: 85, y: 420, w: 350, h: 150 };
    expect(inReadingOrder([next, back, front])).toEqual([front, back, next]);
  });
});

describe('pairBacks', () => {
  const f1: PxRect = { x: 0, y: 0, w: 350, h: 150 };
  const b1: PxRect = { x: 400, y: 0, w: 350, h: 150 };
  const f2: PxRect = { x: 0, y: 200, w: 350, h: 150 };
  const c2: PxRect = { x: 400, y: 200, w: 350, h: 150 };

  it('joins a back to the front beside it — never a cheque of its own', () => {
    expect(pairBacks([f1, b1, f2, c2], [false, true, false, false])).toEqual([
      { front: f1, back: b1 },
      { front: f2, back: null },
      { front: c2, back: null },
    ]);
  });

  it('takes the first of a row as a front, whatever OCR thought', () => {
    expect(pairBacks([f1, b1], [true, true])).toEqual([
      { front: f1, back: b1 },
    ]);
  });
});

describe('backColumn', () => {
  const grid = inReadingOrder(chequeRects(page, W, H));

  it('makes the whole right column backs once one is a back and none has a number', () => {
    const ocrBack = [false, false, false, true, false, false, false, false];
    expect(
      backColumn(
        grid,
        ocrBack,
        grid.map(() => false),
      ),
    ).toEqual([false, true, false, true, false, true, false, true]);
  });

  it('leaves two fronts side by side alone (a number on the right)', () => {
    const ocrBack = [false, true, false, false, false, false, false, false];
    const numbers = [true, false, true, true, true, false, true, false];
    expect(backColumn(grid, ocrBack, numbers)).toEqual(ocrBack);
  });

  it('needs a grid: a page with a single cheque in a row is left as read', () => {
    const odd = [...grid.slice(0, 6), grid[6]];
    const ocrBack = [false, true, false, false, false, false, false];
    expect(
      backColumn(
        odd,
        ocrBack,
        odd.map(() => false),
      ),
    ).toEqual(ocrBack);
  });
});

describe('cutBox', () => {
  it("takes the front, its back and the bank's caption above — never the row above", () => {
    const above: PxRect = { x: 84, y: 192, w: 749, h: 165 };
    const front: PxRect = { x: 84, y: 413, w: 354, h: 165 };
    const back: PxRect = { x: 478, y: 413, w: 355, h: 166 };
    const box = cutBox({ front, back }, [above, front, back], W, H);
    expect(box.x0).toBeLessThan(84 / W);
    expect(box.x1).toBeGreaterThan(833 / W);
    // Up to 20% of the cheque's height above it (the caption), not into the row above.
    expect(box.y0 * H).toBeCloseTo(413 - 165 * 0.2, 0);
    expect(box.y0 * H).toBeGreaterThanOrEqual(192 + 165);
    expect(box.y1 * H).toBeGreaterThanOrEqual(579);
  });
});
