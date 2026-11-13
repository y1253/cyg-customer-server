import sharp from 'sharp';
import { PictureEnhancerService } from './picture-enhancer.service';

describe('PictureEnhancerService (real sharp)', () => {
  const service = new PictureEnhancerService();

  it('turns a sideways photo upright, enlarges it without cropping and keeps it a JPEG', async () => {
    // 400×300 stored, EXIF orientation 6 = shown 300×400.
    const input = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 60, g: 60, b: 60 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await service.enhance(input, 'image/jpeg');
    expect(out).not.toBeNull();
    const meta = await sharp(out!).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([600, 800]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('keeps a PNG a PNG', async () => {
    const input = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .png()
      .toBuffer();
    const out = await service.enhance(input, 'image/png');
    expect((await sharp(out!).metadata()).format).toBe('png');
  });

  it('never throws: a broken picture or a PDF comes back null', async () => {
    await expect(service.enhance(Buffer.from('not a picture'), 'image/jpeg')).resolves.toBeNull();
    await expect(service.enhance(Buffer.from('%PDF-1.4'), 'application/pdf')).resolves.toBeNull();
  });
});
