"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OcrService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcrService = void 0;
exports.imageSize = imageSize;
const path_1 = require("path");
const fs_1 = require("fs");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let OcrService = OcrService_1 = class OcrService {
    config;
    logger = new common_1.Logger(OcrService_1.name);
    engine = null;
    queue = Promise.resolve();
    constructor(config) {
        this.config = config;
    }
    enabled() {
        return this.config.get('OCR')?.trim() !== '0';
    }
    async read(image, timeoutMs = 90_000) {
        if (!this.enabled())
            return null;
        const run = this.queue.then(() => this.readNow(image, timeoutMs));
        this.queue = run.catch(() => undefined);
        return run;
    }
    async onModuleDestroy() {
        const engine = await this.engine?.catch(() => null);
        await engine?.destroy().catch(() => undefined);
    }
    async readNow(image, timeoutMs) {
        const engine = await this.load();
        if (!engine)
            return null;
        const started = Date.now();
        let timer;
        try {
            const bytes = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
            const result = await Promise.race([
                engine.recognize(bytes, { noCache: true }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
                }),
            ]);
            const lines = (result.lines ?? []).map((line) => ({
                text: line.map((b) => b.text).join(' '),
                confidence: line.length
                    ? Math.min(...line.map((b) => b.confidence))
                    : 0,
                boxes: line.map((b) => ({
                    text: b.text,
                    confidence: b.confidence,
                    x: b.box.x,
                    y: b.box.y,
                    width: b.box.width,
                    height: b.box.height,
                })),
            }));
            this.logger.debug(`read ${lines.length} line(s) in ${Date.now() - started} ms`);
            const size = await imageSize(image);
            if (!size)
                return null;
            return {
                text: lines.map((l) => l.text).join('\n'),
                confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
                lines,
                ...size,
            };
        }
        catch (err) {
            this.logger.warn(`OCR failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    load() {
        if (!this.engine) {
            this.engine = this.create().catch((err) => {
                this.logger.error(`PaddleOCR could not start: ${err instanceof Error ? err.message : String(err)}`);
                this.engine = null;
                return null;
            });
        }
        return this.engine;
    }
    async create() {
        const lib = await import('ppu-paddle-ocr');
        const dir = this.config.get('PADDLE_OCR_MODEL_DIR')?.trim();
        const files = dir
            ? {
                detection: (0, path_1.join)(dir, 'PP-OCRv6_medium_det.ort'),
                recognition: (0, path_1.join)(dir, 'PP-OCRv6_medium_rec.ort'),
                charactersDictionary: (0, path_1.join)(dir, 'ppocrv6_dict.txt'),
            }
            : null;
        const local = files && Object.values(files).every((f) => (0, fs_1.existsSync)(f));
        if (dir && !local) {
            this.logger.warn(`PADDLE_OCR_MODEL_DIR=${dir} is missing model files — using the library's download`);
        }
        const service = new lib.PaddleOcrService({
            model: local ? files : lib.V6_MEDIUM_MODEL,
            debugging: { verbose: false, debug: false },
        });
        const started = Date.now();
        await service.initialize();
        this.logger.log(`PaddleOCR ready (PP-OCRv6 medium${local ? `, ${dir}` : ''}) in ${Date.now() - started} ms`);
        return service;
    }
};
exports.OcrService = OcrService;
exports.OcrService = OcrService = OcrService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OcrService);
async function imageSize(image) {
    try {
        const mupdf = await import('mupdf');
        const img = new mupdf.Image(image);
        try {
            return { width: img.getWidth(), height: img.getHeight() };
        }
        finally {
            img.destroy();
        }
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=ocr.service.js.map