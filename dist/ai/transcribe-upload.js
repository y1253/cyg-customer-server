"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRANSCRIBE_BYTES = void 0;
exports.transcribeFileFilter = transcribeFileFilter;
const common_1 = require("@nestjs/common");
exports.MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
function transcribeFileFilter(_req, file, cb) {
    const base = (file.mimetype || '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (base.startsWith('audio/'))
        return cb(null, true);
    cb(new common_1.BadRequestException('That is not an audio recording.'), false);
}
//# sourceMappingURL=transcribe-upload.js.map