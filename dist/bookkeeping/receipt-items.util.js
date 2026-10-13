"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemSplits = itemSplits;
exports.itemKey = itemKey;
const name_memory_util_1 = require("./name-memory.util");
const reconcile_util_1 = require("./reconcile.util");
function itemSplits(items, tax, bankAmount, categoryFor) {
    const usable = items
        .map((i) => ({ name: i.name.trim().slice(0, 191), price: (0, reconcile_util_1.cents)(i.amount) }))
        .filter((i) => i.name && i.price > 0);
    if (!usable.length)
        return { problem: 'No items could be read off it' };
    const subtotal = usable.reduce((n, i) => n + i.price, 0);
    const taxCents = Math.max(0, (0, reconcile_util_1.cents)(tax ?? 0));
    let given = 0;
    const gross = usable.map((i, idx) => {
        const share = idx === usable.length - 1
            ? taxCents - given
            : Math.round((taxCents * i.price) / subtotal);
        given += share;
        return i.price + share;
    });
    const total = gross.reduce((n, g) => n + g, 0);
    const charge = Math.abs((0, reconcile_util_1.cents)(bankAmount));
    if (total > charge) {
        return {
            problem: `The receipt adds up to $${(total / 100).toFixed(2)}, more than the ` +
                `$${(charge / 100).toFixed(2)} charge`,
        };
    }
    return {
        splits: usable.map((i, idx) => ({
            itemName: i.name,
            category: categoryFor(i.name),
            amount: gross[idx] / 100,
        })),
    };
}
function itemKey(itemName) {
    return (0, name_memory_util_1.descriptionKey)(itemName).slice(0, 191);
}
//# sourceMappingURL=receipt-items.util.js.map