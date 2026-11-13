import {
  MAX_LONG_EDGE,
  needsDenoise,
  pictureFormatOf,
  resizePlan,
  sharpenFor,
  toneFor,
} from './picture-enhance';

describe('picture clean-up rules (step2, 2026-11-13)', () => {
  it('cleans up JPEG, PNG and WebP only — never GIF, HEIC, PDF or audio', () => {
    expect(pictureFormatOf('image/jpeg')).toBe('jpeg');
    expect(pictureFormatOf('IMAGE/JPG; charset=x')).toBe('jpeg');
    expect(pictureFormatOf('image/png')).toBe('png');
    expect(pictureFormatOf('image/webp')).toBe('webp');
    for (const m of ['image/gif', 'image/heic', 'application/pdf', 'audio/mpeg', '', null])
      expect(pictureFormatOf(m)).toBeNull();
  });

  it('never crops: the aspect is kept, a big picture shrinks, a small one grows at most 2×', () => {
    expect(resizePlan(6000, 4000)).toEqual({ width: MAX_LONG_EDGE, height: 2000, upscaled: false });
    expect(resizePlan(400, 300)).toEqual({ width: 800, height: 600, upscaled: true });
    expect(resizePlan(1000, 500)).toEqual({ width: 1600, height: 800, upscaled: true });
    expect(resizePlan(2000, 1500)).toBeNull();
    expect(resizePlan(0, 10)).toBeNull();
  });

  it('a well-exposed receipt gets no tone change; a flat or dark one is stretched', () => {
    expect(toneFor({ mean: 215, stdev: 60 })).toBeNull();
    expect(toneFor({ mean: 200, stdev: 20 })).toEqual({ lower: 1, upper: 99 });
    expect(toneFor({ mean: 70, stdev: 50 })).toEqual({ lower: 1, upper: 99 });
    expect(toneFor(null)).toBeNull();
  });

  it('denoises only a dark picture, and sharpens without boosting paper grain', () => {
    expect(needsDenoise({ mean: 60, stdev: 30 })).toBe(true);
    expect(needsDenoise({ mean: 150, stdev: 30 })).toBe(false);
    expect(sharpenFor(false)).toEqual({ sigma: 0.8, m1: 0, m2: 2 });
    expect(sharpenFor(true).sigma).toBe(1.0);
  });
});
