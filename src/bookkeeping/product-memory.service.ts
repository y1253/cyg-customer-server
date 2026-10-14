import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { doubleEntry } from './ledger.util';
import { ProductCategorizer } from './product-categorizer';
import {
  groupProducts,
  itemsToAsk,
  productMemoryWrites,
  resolveItem,
  type ProductView,
} from './product-memory.util';
import { itemKey } from './receipt-items.util';
import { TaxService } from './tax.service';

/**
 * The two memories of which category a receipt item ("product") goes in — the item
 * counterpart of `NameMemoryService`:
 *
 * - `ProductMemory` — FIRM-WIDE, what the AI chose for an item the first time anyone's
 *   receipt had it. Looked up BEFORE the AI is asked, so a known item is never sent again.
 * - `CustomerItemRule` — one customer's OWN choice (Products tab, or "Always" in the Split
 *   dialog), which wins over the memory for that customer only and never leaks into it.
 *
 * The rules themselves are pure (`product-memory.util.ts`); this is only the IO around them.
 */
@Injectable()
export class ProductMemoryService {
  private readonly logger = new Logger(ProductMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
    private readonly categorizer: ProductCategorizer,
    private readonly tax: TaxService,
  ) {}

  /**
   * The category for each of a receipt's items: the customer's rule, else the firm memory,
   * else — for items neither knows — the AI, whose answers the memory then keeps; else the
   * transaction's own category. Never throws: an AI or memory outage keeps the parent's.
   */
  async categoriesFor(
    customerId: number,
    names: readonly string[],
    context: { store?: string | null; parentCategory: string },
  ): Promise<(itemName: string) => string> {
    const fallback = () => context.parentCategory;
    try {
      const keys = [...new Set(names.map(itemKey).filter(Boolean))];
      const [rules, memory] = await Promise.all([
        this.itemRules(customerId),
        this.memoryFor(keys),
      ]);
      const ask = itemsToAsk(names, rules, memory);
      if (ask.length && this.categorizer.configured) {
        try {
          const answers = await this.categorizer.categorize(ask, {
            store: context.store,
            category: context.parentCategory,
          });
          const named = ask.flatMap((a) => {
            const category = answers.get(a.key);
            return category ? [{ ...a, category }] : [];
          });
          await this.learn(named, memory);
          // Every asked key was unknown or Uncategorized, so the answer is what applies now.
          for (const w of named) memory.set(w.key, w.category);
        } catch (err) {
          this.logger.warn(
            `item categories for customer #${customerId} failed: ${(err as Error).message}`,
          );
        }
      }
      const reused = keys.filter(
        (k) => !rules.has(k) && !ask.some((a) => a.key === k) && memory.has(k),
      );
      if (reused.length) {
        await this.prisma.productMemory.updateMany({
          where: { itemKey: { in: reused } },
          data: { hits: { increment: 1 } },
        });
      }
      return (name) =>
        resolveItem(itemKey(name), rules, memory, context.parentCategory)
          .category;
    } catch (err) {
      this.logger.error(
        `item memory for customer #${customerId} failed: ${(err as Error).message}`,
      );
      return fallback;
    }
  }

  /** The category each of the customer's remembered items goes in, keyed by `itemKey`. */
  async itemRules(customerId: number): Promise<Map<string, string>> {
    const rules = await this.prisma.customerItemRule.findMany({
      where: { customerId },
      select: { itemKey: true, category: true },
    });
    return new Map(rules.map((r) => [r.itemKey, r.category]));
  }

  /** The Products tab: every item on the customer's receipts, with its category. */
  async products(customerId: number): Promise<ProductView[]> {
    const rows = await this.itemRows(customerId);
    const keys = [...new Set(rows.map((r) => itemKey(r.itemName)))];
    const [rules, memory] = await Promise.all([
      this.itemRules(customerId),
      this.memoryFor(keys),
    ]);
    return groupProducts(rows, rules, memory);
  }

  /**
   * "Always put this item in this category": saved as the customer's rule, and their
   * existing rows of it are moved at once (taxes re-decided), so the ledger and reports are
   * right without a Generate. Every later receipt gets it too.
   */
  async saveRule(
    customerId: number,
    rawKey: string,
    rawCategory: string,
  ): Promise<void> {
    const key = itemKey(rawKey) || rawKey.trim().toLowerCase().slice(0, 191);
    if (!key) throw new NotFoundException('That product has no name');
    const category = await this.accounts.validCategory(customerId, rawCategory);
    await this.prisma.customerItemRule.upsert({
      where: { customerId_itemKey: { customerId, itemKey: key } },
      create: { customerId, itemKey: key, category },
      update: { category },
    });
    const rows = (await this.itemRows(customerId)).filter(
      (r) => itemKey(r.itemName) === key,
    );
    await this.writeRows(customerId, rows, () => category);
  }

  /**
   * Remove the customer's rule: their rows of that item go back to what the firm memory
   * says, else to the category of the transaction they were split from.
   */
  async resetRule(customerId: number, rawKey: string): Promise<void> {
    const key = itemKey(rawKey) || rawKey.trim().toLowerCase();
    const where = { customerId_itemKey: { customerId, itemKey: key } };
    const rule = await this.prisma.customerItemRule.findUnique({ where });
    if (!rule)
      throw new NotFoundException('That product has no saved category');
    await this.prisma.customerItemRule.delete({ where });
    const rows = (await this.itemRows(customerId)).filter(
      (r) => itemKey(r.itemName) === key,
    );
    const memory = await this.memoryFor([key]);
    await this.writeRows(
      customerId,
      rows,
      (r) => resolveItem(key, new Map(), memory, r.parentCategory).category,
    );
  }

  /** The firm memory for these keys, `itemKey` → category. */
  private async memoryFor(
    keys: readonly string[],
  ): Promise<Map<string, string>> {
    if (!keys.length) return new Map();
    const found = await this.prisma.productMemory.findMany({
      where: { itemKey: { in: [...keys] } },
      select: { itemKey: true, category: true },
    });
    return new Map(found.map((m) => [m.itemKey, m.category]));
  }

  /** Store the AI's answers the memory lacks; fill the ones it held as Uncategorized. */
  private async learn(
    answers: ReadonlyArray<{ key: string; name: string; category: string }>,
    memory: ReadonlyMap<string, string>,
  ): Promise<void> {
    const { creates, fills } = productMemoryWrites(answers, memory);
    if (creates.length) {
      await this.prisma.productMemory.createMany({
        data: creates,
        skipDuplicates: true,
      });
    }
    for (const f of fills) {
      await this.prisma.productMemory.update({
        where: { itemKey: f.itemKey },
        data: { category: f.category },
      });
    }
  }

  /** The customer's item rows: splits with a receipt line, on statements in the ledger. */
  private async itemRows(customerId: number): Promise<ItemRow[]> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        customerId,
        splitOfId: { not: null },
        itemName: { not: null },
        statement: { deletedAt: null, status: StatementStatus.DONE },
      },
      select: {
        id: true,
        itemName: true,
        amount: true,
        offsetAccount: true,
        debitAccount: true,
        creditAccount: true,
        splitOf: { select: { offsetAccount: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      itemName: r.itemName ?? '',
      amount: Number(r.amount),
      offsetAccount: r.offsetAccount,
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
      parentCategory: r.splitOf?.offsetAccount ?? r.offsetAccount,
    }));
  }

  /** Move these rows to `next`'s category, then re-decide THEIR taxes at once. */
  private async writeRows(
    customerId: number,
    rows: readonly ItemRow[],
    next: (row: ItemRow) => string,
  ): Promise<void> {
    const changed: number[] = [];
    const updates = rows.flatMap((row) => {
      const category = next(row);
      if (category === row.offsetAccount) return [];
      changed.push(row.id);
      // The bank side never changes; only the offset does, so re-derive both columns.
      const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
      return [
        this.prisma.bankTransaction.update({
          where: { id: row.id },
          data: {
            offsetAccount: category,
            ...doubleEntry(row.amount, bank, category),
          },
        }),
      ];
    });
    if (!updates.length) return;
    await this.prisma.$transaction(updates);
    await this.tax.retagRows(customerId, changed);
  }
}

interface ItemRow {
  id: number;
  itemName: string;
  amount: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
  /** The category of the transaction this item was split from. */
  parentCategory: string;
}
