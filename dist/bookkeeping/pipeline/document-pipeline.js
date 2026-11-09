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
var DocumentPipeline_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentPipeline = void 0;
exports.pdfPagePngs = pdfPagePngs;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ocr_service_1 = require("./ocr.service");
const ocr_util_1 = require("./ocr.util");
const pdf_text_1 = require("./pdf-text");
const sheet_text_1 = require("./sheet-text");
const MAX_PDF_PAGES = 10;
const MAX_OCR_PAGES = 3;
const MAX_TEXT_CHARS = 30_000;
let DocumentPipeline = DocumentPipeline_1 = class DocumentPipeline {
    ocr;
    config;
    logger = new common_1.Logger(DocumentPipeline_1.name);
    constructor(ocr, config) {
        this.ocr = ocr;
        this.config = config;
    }
    enabled() {
        return this.config.get('DOC_PIPELINE')?.trim() !== '0';
    }
    readImage(image) {
        return this.enabled() ? this.ocr.read(image) : Promise.resolve(null);
    }
    async prepare(file, mime, cls, known) {
        if (cls === 'sheet')
            return this.sheet(file, mime);
        if (!this.enabled())
            return null;
        try {
            if (cls === 'image')
                return this.fromOcr(known ?? (await this.ocr.read(file)));
            if (cls === 'pdf')
                return await this.pdf(file);
            return null;
        }
        catch (err) {
            this.logger.warn(`pipeline failed (${cls}): ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    fromOcr(r) {
        if (!r)
            return null;
        const verdict = (0, ocr_util_1.ocrGate)(r);
        return {
            source: 'OCR',
            ok: verdict.ok,
            text: (0, ocr_util_1.ocrText)(r).slice(0, MAX_TEXT_CHARS),
            confidence: r.confidence,
            reason: verdict.ok ? null : verdict.reason,
            cheque: verdict.cheque,
            chequeNumber: verdict.cheque ? (0, ocr_util_1.chequeNumberFromOcr)(r) : null,
        };
    }
    async sheet(file, mime) {
        const text = await (0, sheet_text_1.sheetText)(file, mime);
        return {
            source: 'SHEET',
            ok: !!text?.trim(),
            text: text ?? '',
            confidence: null,
            reason: text?.trim() ? null : 'could not open the spreadsheet',
            cheque: false,
            chequeNumber: null,
        };
    }
    async pdf(file) {
        const pages = await (0, pdf_text_1.pdfPageTexts)(file);
        if (!pages?.length)
            return null;
        if (pages.length <= MAX_PDF_PAGES) {
            const text = pages
                .map((t, i) => (pages.length > 1 ? `--- page ${i + 1} ---\n${t}` : t))
                .join('\n\n');
            const quality = (0, pdf_text_1.pdfTextQuality)(text);
            if (quality.ok) {
                return {
                    source: 'PDF_TEXT',
                    ok: true,
                    text: text.slice(0, MAX_TEXT_CHARS),
                    confidence: null,
                    reason: null,
                    cheque: false,
                    chequeNumber: null,
                };
            }
        }
        if (pages.length > MAX_OCR_PAGES) {
            return {
                source: 'PDF_TEXT',
                ok: false,
                text: '',
                confidence: null,
                reason: `${pages.length} pages with no usable text layer`,
                cheque: false,
                chequeNumber: null,
            };
        }
        const reads = [];
        for (const png of await pdfPagePngs(file, MAX_OCR_PAGES)) {
            const p = this.fromOcr(await this.ocr.read(png));
            if (!p)
                return null;
            reads.push(p);
        }
        if (!reads.length)
            return null;
        const failed = reads.find((r) => !r.ok);
        return {
            source: 'OCR',
            ok: !failed,
            text: reads
                .map((r, i) => reads.length > 1 ? `--- page ${i + 1} ---\n${r.text}` : r.text)
                .join('\n\n')
                .slice(0, MAX_TEXT_CHARS),
            confidence: Math.min(...reads.map((r) => r.confidence ?? 0)),
            reason: failed?.reason ?? null,
            cheque: reads.some((r) => r.cheque),
            chequeNumber: reads.length === 1 ? reads[0].chequeNumber : null,
        };
    }
};
exports.DocumentPipeline = DocumentPipeline;
exports.DocumentPipeline = DocumentPipeline = DocumentPipeline_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ocr_service_1.OcrService,
        config_1.ConfigService])
], DocumentPipeline);
async function pdfPagePngs(pdf, max) {
    try {
        const mupdf = await import('mupdf');
        const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
        try {
            if (doc.needsPassword())
                return [];
            const out = [];
            const count = Math.min(doc.countPages(), max);
            for (let i = 0; i < count; i++) {
                const page = doc.loadPage(i);
                try {
                    const pix = page.toPixmap([2, 0, 0, 2, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
                    try {
                        out.push(Buffer.from(pix.asPNG()));
                    }
                    finally {
                        pix.destroy();
                    }
                }
                finally {
                    page.destroy();
                }
            }
            return out;
        }
        finally {
            doc.destroy();
        }
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=document-pipeline.js.map