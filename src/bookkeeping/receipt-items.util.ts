import { descriptionKey } from './name-memory.util';
import { cents } from './reconcile.util';

/** One line the AI read off a receipt: its price as printed, after line discounts. */
export interface ReceiptItem {
  name: string;
  amount: number;
}

/** One split to make from a receipt: positive, tax-inclusive, in dollars. */
export interface ItemSplit {
  itemName: string;
  category: string;
  amount: number;
}

/**
 * The splits a receipt makes on a bank transaction (PURE, integer cents).
 *
 * A receipt prints pre-tax prices and one tax total, while the bank moved the total with
 * tax INCLUDED — and our tax engine works on tax-included amounts (`includedTaxes`). So
 * each item carries its share of the receipt's tax, by price, and the last item absorbs
 * the rounding: the items add back to subtotal + tax to the cent. The tax engine then
 * takes each item's tax back out using the item's OWN category.
 *
 * Returns `{ problem }` instead when the receipt cannot be laid on this transaction:
 * no usable items, or items that add up to MORE than the charge (`splitProblem` would
 * refuse it anyway). Less is fine — the rest (a tip, an unread line) stays on the parent.
 */
export function itemSplits(
  items: readonly ReceiptItem[],
  tax: number | null | undefined,
  bankAmount: number,
  categoryFor: (itemName: string) => string,
): { splits: ItemSplit[] } | { problem: string } {
  const usable = items
    .map((i) => ({ name: i.name.trim().slice(0, 191), price: cents(i.amount) }))
    .filter((i) => i.name && i.price > 0);
  if (!usable.length) return { problem: 'No items could be read off it' };

  const subtotal = usable.reduce((n, i) => n + i.price, 0);
  const taxCents = Math.max(0, cents(tax ?? 0));
  let given = 0;
  const gross = usable.map((i, idx) => {
    const share =
      idx === usable.length - 1
        ? taxCents - given
        : Math.round((taxCents * i.price) / subtotal);
    given += share;
    return i.price + share;
  });

  const total = gross.reduce((n, g) => n + g, 0);
  const charge = Math.abs(cents(bankAmount));
  if (total > charge) {
    return {
      problem:
        `The receipt adds up to $${(total / 100).toFixed(2)}, more than the ` +
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

/** The key an item's "Always" category is remembered under ("Pampers Size 4" → "pampers size"). */
export function itemKey(itemName: string): string {
  return descriptionKey(itemName).slice(0, 191);
}
