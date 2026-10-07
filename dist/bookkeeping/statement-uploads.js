"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATEMENT_UPLOAD_OPTIONS = exports.MAX_FILES_PER_REQUEST = exports.MAX_STATEMENT_BYTES = void 0;
exports.sweepStaleStaging = sweepStaleStaging;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const common_1 = require("@nestjs/common");
const multer_1 = require("multer");
exports.MAX_STATEMENT_BYTES = 50 * 1024 * 1024;
exports.MAX_FILES_PER_REQUEST = 20;
const STAGING_DIR = (0, path_1.join)(process.env.UPLOADS_DIR?.trim() || (0, path_1.join)(process.cwd(), 'uploads'), 'bookkeeping-staging');
exports.STATEMENT_UPLOAD_OPTIONS = {
    storage: (0, multer_1.diskStorage)({
        destination: (_req, _file, cb) => {
            (0, fs_1.mkdirSync)(STAGING_DIR, { recursive: true });
            cb(null, STAGING_DIR);
        },
        filename: (_req, _file, cb) => cb(null, `${(0, crypto_1.randomUUID)()}.pdf`),
    }),
    limits: { fileSize: exports.MAX_STATEMENT_BYTES, files: exports.MAX_FILES_PER_REQUEST },
    fileFilter: (_req, file, cb) => {
        const isPdfName = /\.pdf$/i.test(file.originalname);
        const okType = [
            'application/pdf',
            'application/x-pdf',
            'application/octet-stream',
            '',
        ].includes(file.mimetype);
        if (isPdfName && okType)
            return cb(null, true);
        cb(new common_1.BadRequestException(`"${file.originalname}" is not a PDF. Only PDF statements can be uploaded.`), false);
    },
};
async function sweepStaleStaging(maxAgeMs) {
    let names;
    try {
        names = await (0, promises_1.readdir)(STAGING_DIR);
    }
    catch {
        return 0;
    }
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const name of names) {
        const full = (0, path_1.join)(STAGING_DIR, name);
        try {
            if ((await (0, promises_1.stat)(full)).mtimeMs < cutoff) {
                await (0, promises_1.unlink)(full);
                removed++;
            }
        }
        catch {
        }
    }
    return removed;
}
//# sourceMappingURL=statement-uploads.js.map