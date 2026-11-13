"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var PictureEnhancerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PictureEnhancerService = void 0;
const common_1 = require("@nestjs/common");
const sharp_1 = __importDefault(require("sharp"));
const picture_enhance_1 = require("./picture-enhance");
let PictureEnhancerService = PictureEnhancerService_1 = class PictureEnhancerService {
    logger = new common_1.Logger(PictureEnhancerService_1.name);
    get enabled() {
        return process.env.PICTURE_ENHANCE !== '0';
    }
    handles(mime) {
        return this.enabled && (0, picture_enhance_1.pictureFormatOf)(mime) !== null;
    }
    async enhance(input, mime) {
        const format = (0, picture_enhance_1.pictureFormatOf)(mime);
        if (!this.enabled || !format)
            return null;
        try {
            const meta = await (0, sharp_1.default)(input, { failOn: 'none' }).metadata();
            if (!meta.width || !meta.height)
                return null;
            const turned = (meta.orientation ?? 1) >= 5;
            const width = turned ? meta.height : meta.width;
            const height = turned ? meta.width : meta.height;
            const size = (0, picture_enhance_1.resizePlan)(width, height);
            const brightness = await this.brightness(input);
            const tone = (0, picture_enhance_1.toneFor)(brightness);
            let img = (0, sharp_1.default)(input, { failOn: 'none' }).rotate();
            if (size)
                img = img.resize({
                    width: size.width,
                    height: size.height,
                    fit: 'inside',
                    kernel: size.upscaled ? 'mitchell' : 'lanczos3',
                });
            if (tone)
                img = img.normalise(tone);
            if ((0, picture_enhance_1.needsDenoise)(brightness))
                img = img.median(3);
            img = img.sharpen((0, picture_enhance_1.sharpenFor)(!!size?.upscaled));
            if (format === 'jpeg')
                img = img.jpeg({
                    quality: picture_enhance_1.JPEG_QUALITY,
                    chromaSubsampling: '4:4:4',
                    mozjpeg: false,
                });
            else if (format === 'png')
                img = img.png({ compressionLevel: 9 });
            else
                img = img.webp({ quality: picture_enhance_1.WEBP_QUALITY });
            return await img.toBuffer();
        }
        catch (e) {
            this.logger.warn(`picture clean-up failed (${mime}, ${input.length} bytes) — stored as sent: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }
    async brightness(input) {
        try {
            const stats = await (0, sharp_1.default)(input, { failOn: 'none' })
                .rotate()
                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                .greyscale()
                .stats();
            const c = stats.channels[0];
            return c ? { mean: c.mean, stdev: c.stdev } : null;
        }
        catch {
            return null;
        }
    }
};
exports.PictureEnhancerService = PictureEnhancerService;
exports.PictureEnhancerService = PictureEnhancerService = PictureEnhancerService_1 = __decorate([
    (0, common_1.Injectable)()
], PictureEnhancerService);
//# sourceMappingURL=picture-enhancer.service.js.map