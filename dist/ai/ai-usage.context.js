"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withAiUsage = withAiUsage;
exports.currentAiUsage = currentAiUsage;
const node_async_hooks_1 = require("node:async_hooks");
const storage = new node_async_hooks_1.AsyncLocalStorage();
function withAiUsage(ctx, fn) {
    const outer = storage.getStore();
    return storage.run({
        customerId: ctx.customerId !== undefined
            ? ctx.customerId
            : (outer?.customerId ?? null),
        companyId: ctx.companyId !== undefined
            ? ctx.companyId
            : (outer?.companyId ?? null),
        feature: ctx.feature,
    }, fn);
}
function currentAiUsage() {
    return (storage.getStore() ?? {
        customerId: null,
        companyId: null,
        feature: 'OTHER',
    });
}
//# sourceMappingURL=ai-usage.context.js.map