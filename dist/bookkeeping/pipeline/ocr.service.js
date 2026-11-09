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
const os_1 = require("os");
const url_1 = require("url");
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
    engineName() {
        return this.config.get('OCR_ENGINE')?.trim().toLowerCase() ===
            'paddle'
            ? 'paddle'
            : 'tesseract';
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
            const result = await Promise.race([
                engine.recognize(image),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
                }),
            ]);
            const { lines } = result;
            this.logger.debug(`${engine.name} read ${lines.length} line(s) in ${Date.now() - started} ms`);
            const size = await imageSize(image);
            if (!size)
                return null;
            return {
                text: lines.map((l) => l.text).join('\n'),
                confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
                lines,
                engine: engine.name,
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
            const name = this.engineName();
            this.engine = (name === 'paddle' ? this.createPaddle() : this.createTesseract()).catch((err) => {
                this.logger.error(`${name} OCR could not start: ${err instanceof Error ? err.message : String(err)}`);
                this.engine = null;
                return null;
            });
        }
        return this.engine;
    }
    async createTesseract() {
        await import((0, url_1.pathToFileURL)(require.resolve('wasm-feature-detect', {
            paths: [(0, path_1.dirname)(require.resolve('tesseract.js'))],
        })).href);
        const tesseract = await import('tesseract.js');
        const langPath = (0, path_1.join)((0, os_1.tmpdir)(), 'cyg-tessdata');
        (0, fs_1.mkdirSync)(langPath, { recursive: true });
        for (const code of ['eng', 'fra']) {
            const file = `${code}.traineddata.gz`;
            (0, fs_1.copyFileSync)((0, path_1.join)((0, path_1.dirname)(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0_best_int', file), (0, path_1.join)(langPath, file));
        }
        const started = Date.now();
        const worker = await tesseract.createWorker('eng+fra', tesseract.OEM.LSTM_ONLY, { langPath, cacheMethod: 'none', gzip: true });
        this.logger.log(`Tesseract ready (eng+fra) in ${Date.now() - started} ms`);
        return {
            name: 'tesseract',
            async recognize(image) {
                const { data } = await worker.recognize(image, {}, { blocks: true });
                const lines = [];
                for (const block of data.blocks ?? []) {
                    for (const para of block.paragraphs) {
                        for (const line of para.lines) {
                            const words = line.words.filter((w) => w.text.trim());
                            if (!words.length)
                                continue;
                            lines.push({
                                text: words.map((w) => w.text).join(' '),
                                confidence: Math.min(...words.map((w) => w.confidence)) / 100,
                                boxes: words.map((w) => ({
                                    text: w.text,
                                    confidence: w.confidence / 100,
                                    x: w.bbox.x0,
                                    y: w.bbox.y0,
                                    width: w.bbox.x1 - w.bbox.x0,
                                    height: w.bbox.y1 - w.bbox.y0,
                                })),
                            });
                        }
                    }
                }
                return { confidence: data.confidence / 100, lines };
            },
            async destroy() {
                await worker.terminate();
            },
        };
    }
    async createPaddle() {
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
        const paddle = service;
        return {
            name: 'paddle',
            async recognize(image) {
                const bytes = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
                const result = await paddle.recognize(bytes, { noCache: true });
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
                return { confidence: result.confidence, lines };
            },
            destroy: () => paddle.destroy(),
        };
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