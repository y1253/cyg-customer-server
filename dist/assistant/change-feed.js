"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeFeed = void 0;
const boot = Date.now().toString(36);
const versions = new Map();
exports.changeFeed = {
    bump(customerId) {
        if (!customerId)
            return;
        versions.set(customerId, (versions.get(customerId) ?? 0) + 1);
    },
    version(customerId) {
        return `${boot}.${versions.get(customerId) ?? 0}`;
    },
};
//# sourceMappingURL=change-feed.js.map