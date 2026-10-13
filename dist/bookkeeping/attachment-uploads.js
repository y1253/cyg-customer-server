"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATTACHMENT_UPLOAD_OPTIONS = exports.MAX_FILES_PER_REQUEST = exports.MAX_ATTACHMENT_BYTES = void 0;
exports.attachmentType = attachmentType;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const common_1 = require("@nestjs/common");
const multer_1 = require("multer");
const statement_uploads_1 = require("./statement-uploads");
Object.defineProperty(exports, "MAX_FILES_PER_REQUEST", { enumerable: true, get: function () { return statement_uploads_1.MAX_FILES_PER_REQUEST; } });
exports.MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const STAGING_DIR = (0, path_1.join)(process.env.UPLOADS_DIR?.trim() || (0, path_1.join)(process.cwd(), 'uploads'), 'bookkeeping-staging');
const KNOWN = {
    '.pdf': { cls: 'pdf', mime: 'application/pdf' },
    '.jpg': { cls: 'image', mime: 'image/jpeg' },
    '.jpeg': { cls: 'image', mime: 'image/jpeg' },
    '.png': { cls: 'image', mime: 'image/png' },
    '.webp': { cls: 'image', mime: 'image/webp' },
    '.gif': { cls: 'image', mime: 'image/gif' },
    '.mp3': { cls: 'audio', mime: 'audio/mpeg' },
    '.m4a': { cls: 'audio', mime: 'audio/mp4' },
    '.mp4': { cls: 'audio', mime: 'audio/mp4' },
    '.wav': { cls: 'audio', mime: 'audio/wav' },
    '.webm': { cls: 'audio', mime: 'audio/webm' },
    '.ogg': { cls: 'audio', mime: 'audio/ogg' },
    '.oga': { cls: 'audio', mime: 'audio/ogg' },
};
function attachmentType(filename) {
    const ext = (0, path_1.extname)(filename).toLowerCase();
    const hit = KNOWN[ext];
    return hit ? { ...hit, ext } : null;
}
exports.ATTACHMENT_UPLOAD_OPTIONS = {
    storage: (0, multer_1.diskStorage)({
        destination: (_req, _file, cb) => {
            (0, fs_1.mkdirSync)(STAGING_DIR, { recursive: true });
            cb(null, STAGING_DIR);
        },
        filename: (_req, file, cb) => cb(null, `${(0, crypto_1.randomUUID)()}${attachmentType(file.originalname)?.ext ?? ''}`),
    }),
    limits: { fileSize: exports.MAX_ATTACHMENT_BYTES, files: statement_uploads_1.MAX_FILES_PER_REQUEST },
    fileFilter: (_req, file, cb) => {
        if (attachmentType(file.originalname))
            return cb(null, true);
        const heic = /\.hei[cf]$/i.test(file.originalname);
        cb(new common_1.BadRequestException(heic
            ? `"${file.originalname}" is an iPhone HEIC photo. Save it as JPG (or set the camera to "Most Compatible") and upload it again.`
            : `"${file.originalname}" can't be added. Upload a photo (JPG, PNG), a PDF or a voice note (MP3, M4A, WAV, WEBM, OGG).`), false);
    },
};
//# sourceMappingURL=attachment-uploads.js.map