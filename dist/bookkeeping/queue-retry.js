"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ATTEMPTS = void 0;
exports.claimableAt = claimableAt;
exports.MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
function claimableAt(updatedAt, attempts) {
    if (attempts === 0)
        return updatedAt.getTime();
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
    return updatedAt.getTime() + delay;
}
//# sourceMappingURL=queue-retry.js.map