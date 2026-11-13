import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  JPEG_QUALITY,
  WEBP_QUALITY,
  needsDenoise,
  pictureFormatOf,
  resizePlan,
  sharpenFor,
  toneFor,
  type Brightness,
} from './picture-enhance';

/**
 * step2 (2026-11-13): the picture clean-up pass — upright (EXIF), a readable size, a
 * luminance stretch for a flat / dark picture, a denoise for a dark one, a mild sharpen.
 * NEVER crops. Rules in `picture-enhance.ts`.
 *
 * ⚠️ TWIN: `internal/server/src/storage/picture-enhancer.service.ts`.
 */
@Injectable()
export class PictureEnhancerService {
  private readonly logger = new Logger(PictureEnhancerService.name);

  /** Off with `PICTURE_ENHANCE=0` (pictures are then stored exactly as sent). */
  get enabled(): boolean {
    return process.env.PICTURE_ENHANCE !== '0';
  }

  /** Whether `mime` is a picture this pass cleans up. */
  handles(mime: string | null | undefined): boolean {
    return this.enabled && pictureFormatOf(mime) !== null;
  }

  /**
   * The cleaned-up picture, in the SAME format (so its name, extension and type stay
   * true), or null when it is not a picture we clean up. Never throws: any failure is
   * logged and null comes back, and the caller stores the original as before.
   */
  async enhance(
    input: Buffer,
    mime: string | null | undefined,
  ): Promise<Buffer | null> {
    const format = pictureFormatOf(mime);
    if (!this.enabled || !format) return null;
    try {
      const meta = await sharp(input, { failOn: 'none' }).metadata();
      if (!meta.width || !meta.height) return null;
      // Orientation 5–8 = rotated 90°: the displayed size is swapped.
      const turned = (meta.orientation ?? 1) >= 5;
      const width = turned ? meta.height : meta.width;
      const height = turned ? meta.width : meta.height;
      const size = resizePlan(width, height);

      const brightness = await this.brightness(input);
      const tone = toneFor(brightness);

      let img = sharp(input, { failOn: 'none' }).rotate();
      if (size)
        img = img.resize({
          width: size.width,
          height: size.height,
          fit: 'inside',
          kernel: size.upscaled ? 'mitchell' : 'lanczos3',
        });
      if (tone) img = img.normalise(tone);
      if (needsDenoise(brightness)) img = img.median(3);
      img = img.sharpen(sharpenFor(!!size?.upscaled));
      if (format === 'jpeg')
        img = img.jpeg({
          quality: JPEG_QUALITY,
          chromaSubsampling: '4:4:4',
          mozjpeg: false,
        });
      else if (format === 'png') img = img.png({ compressionLevel: 9 });
      else img = img.webp({ quality: WEBP_QUALITY });
      return await img.toBuffer();
    } catch (e) {
      this.logger.warn(
        `picture clean-up failed (${mime}, ${input.length} bytes) — stored as sent: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** Mean / spread of the grey picture, on a 512px copy (cheap, and plenty to judge by). */
  private async brightness(input: Buffer): Promise<Brightness | null> {
    try {
      const stats = await sharp(input, { failOn: 'none' })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .greyscale()
        .stats();
      const c = stats.channels[0];
      return c ? { mean: c.mean, stdev: c.stdev } : null;
    } catch {
      return null;
    }
  }
}
