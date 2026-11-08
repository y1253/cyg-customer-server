"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_DETAIL_MAX = exports.UnreadableStatementError = void 0;
exports.failureReason = failureReason;
class UnreadableStatementError extends Error {
}
exports.UnreadableStatementError = UnreadableStatementError;
exports.ERROR_DETAIL_MAX = 2000;
function failureReason(message) {
    if (/password|encrypt/i.test(message))
        return 'This file is password-protected. Upload a copy without a password.';
    if (/timed? ?out|timeout|ETIMEDOUT|aborted/i.test(message))
        return 'Reading this statement took too long and was stopped. Please try again — a file with fewer pages reads faster.';
    if (/rate.?limit|\b429\b|quota|overloaded|\b50[0-4]\b|ECONNRESET|ENOTFOUND/i.test(message))
        return 'Our reading service was busy or unreachable. Please try again in a few minutes.';
    if (/refus|content.?filter|safety/i.test(message))
        return 'The reader refused to read this file. Upload a clearer copy, or ask the AI below what to do.';
    if (/no pages|0 pages|empty/i.test(message))
        return 'This file has no pages we could read. Upload the statement again.';
    if (/JSON|Unexpected token|parse|schema/i.test(message))
        return 'The reader could not make sense of this statement (it may be unusual or very long). Please try again, or tell the AI below what is on it.';
    return 'We could not read this statement. Please try again, or upload a clearer copy.';
}
//# sourceMappingURL=statement-errors.js.map