"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBP_QUALITY = exports.JPEG_QUALITY = exports.needsDenoise = exports.DENOISE_MEAN = exports.DARK_MEAN = exports.FLAT_STDEV = exports.MAX_UPSCALE = exports.MIN_LONG_EDGE = exports.MAX_LONG_EDGE = void 0;
exports.pictureFormatOf = pictureFormatOf;
exports.resizePlan = resizePlan;
exports.toneFor = toneFor;
exports.sharpenFor = sharpenFor;
function pictureFormatOf(mime) {
    const m = (mime ?? '').toLowerCase().split(';')[0].trim();
    if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/pjpeg')
        return 'jpeg';
    if (m === 'image/png')
        return 'png';
    if (m === 'image/webp')
        return 'webp';
    return null;
}
exports.MAX_LONG_EDGE = 3000;
exports.MIN_LONG_EDGE = 1600;
exports.MAX_UPSCALE = 2;
function resizePlan(width, height) {
    if (!(width > 0) || !(height > 0))
        return null;
    const long = Math.max(width, height);
    let scale = 1;
    if (long > exports.MAX_LONG_EDGE)
        scale = exports.MAX_LONG_EDGE / long;
    else if (long < exports.MIN_LONG_EDGE)
        scale = Math.min(exports.MAX_UPSCALE, exports.MIN_LONG_EDGE / long);
    if (scale === 1)
        return null;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        upscaled: scale > 1,
    };
}
exports.FLAT_STDEV = 45;
exports.DARK_MEAN = 110;
exports.DENOISE_MEAN = 80;
function toneFor(b) {
    if (!b)
        return null;
    if (b.stdev >= exports.FLAT_STDEV && b.mean >= exports.DARK_MEAN)
        return null;
    return { lower: 1, upper: 99 };
}
const needsDenoise = (b) => !!b && b.mean < exports.DENOISE_MEAN;
exports.needsDenoise = needsDenoise;
function sharpenFor(upscaled) {
    return { sigma: upscaled ? 1.0 : 0.8, m1: 0, m2: 2 };
}
exports.JPEG_QUALITY = 92;
exports.WEBP_QUALITY = 92;
//# sourceMappingURL=picture-enhance.js.map