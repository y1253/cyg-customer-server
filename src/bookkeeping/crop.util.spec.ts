import { cleanBox } from './attachment-extractor';
import { cropPlan, toPageBox } from './crop.util';

const left = { x0: 0.02, y0: 0.05, x1: 0.48, y1: 0.95 };
const right = { x0: 0.52, y0: 0.05, x1: 0.98, y1: 0.95 };

describe('cropPlan (step9)', () => {
  it('cuts two cheques side by side into two files', () => {
    expect(cropPlan([left, right])).toEqual([left, right]);
  });

  it('keeps one document, or any document without a box, whole', () => {
    expect(cropPlan([left])).toBeNull();
    expect(cropPlan([left, null])).toBeNull();
    expect(cropPlan([left, undefined])).toBeNull();
  });

  it('does not trust boxes that are mostly the same area, or the whole image', () => {
    expect(cropPlan([left, { ...left, x1: 0.47 }])).toBeNull();
    expect(cropPlan([{ x0: 0, y0: 0, x1: 1, y1: 1 }, right])).toBeNull();
  });
});

describe('toPageBox (step9)', () => {
  it('grows a box by the margin and keeps it inside the image', () => {
    expect(toPageBox({ x0: 0, y0: 0.5, x1: 0.5, y1: 1 }, 800, 400)).toEqual([
      0, 196, 408, 400,
    ]);
  });
});

describe('cleanBox (step9)', () => {
  it('orders the corners and clamps them to the image', () => {
    expect(cleanBox({ x0: 0.6, y0: 1.4, x1: 0.1, y1: 0.2 })).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: 0.6,
      y1: 1,
    });
  });

  it('drops a sliver, a missing corner or no box', () => {
    expect(cleanBox({ x0: 0.1, y0: 0.1, x1: 0.12, y1: 0.9 })).toBeNull();
    expect(cleanBox({ x0: 0.1, y0: 0.1, x1: 0.5 })).toBeNull();
    expect(cleanBox(null)).toBeNull();
  });
});
