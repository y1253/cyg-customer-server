"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPricing = readPricing;
async function readPricing(prisma) {
    const row = await prisma.customerPricing.findUnique({
        where: { singleton: 'GLOBAL' },
    });
    return {
        generatePriceCents: row?.generatePriceCents ?? 0,
        currency: row?.currency ?? 'cad',
    };
}
//# sourceMappingURL=pricing.js.map