import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { doubleEntry } from './ledger.util';
import { NameMemoryService, type EditScope } from './name-memory.service';
import { cleanName, fallbackName } from './name-memory.util';
import { ProductMemoryService } from './product-memory.service';
import { itemKey } from './receipt-items.util';
import { scopeWhere, type BookScope } from './scope';
import {
  childSplitProblem,
  signedLike,
  splitProblem,
  subtreeIds,
} from './splits.util';
import { SubNamesService } from './sub-names.service';
import { dropUnusedSubName, syncParentSubNames } from './sub-name-parents';
import { TaxService } from './tax.service';

export interface SplitInput {
  id?: number;
  name?: string | null;
  /** The receipt line it is for ("Pampers"); null = none. */
  itemName?: string | null;
  category: string;
  /** Positive, as the customer typed it; stored with the parent's sign. */
  amount: number;
  /** Remember this item's category for later receipts (`CustomerItemRule`). */
  always?: boolean;
}

/** step2 (2026-11-15): one split edited in place; only the fields given change. */
export interface SplitEdit {
  /** Positive, as typed; 0 allowed. */
  amount?: number;
  name?: string;
  /** ONCE (default) = this split; ALWAYS = its transaction's description goes to the name. */
  nameScope?: EditScope;
  replace?: boolean;
  category?: string;
  /** ALL = the name's category; SUB (default when it differs) = a sub-name for this split. */
  categoryScope?: 'ALL' | 'SUB';
  /** '' clears it. */
  itemName?: string;
  always?: boolean;
}

const DONE_STATEMENT = { deletedAt: null, status: StatementStatus.DONE };

/**
 * Hand-made splits: parts of one bank transaction the customer moves to their own name
 * and category (`splits.util.ts`). Each is a child `BankTransaction`, flagged `manualEdit`
 * so an "Always" rule never rewrites it, and taxed on its own like any row.
 */
@Injectable()
export class SplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
    private readonly tax: TaxService,
    private readonly products: ProductMemoryService,
    private readonly names: NameMemoryService,
    private readonly subNames: SubNamesService,
  ) {}

  /**
   * Replace the transaction's splits with `input`: listed ids are updated, new ones made,
   * the rest removed. Then the parent's and the splits' taxes are decided again, so the
   * ledger and the reports are right as soon as this returns.
   */
  async save(scope: BookScope, id: number, input: SplitInput[]): Promise<void> {
    const parent = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        ...scopeWhere(scope),
        statement: { deletedAt: null, status: StatementStatus.DONE },
      },
      include: {
        splits: { select: { id: true, parentSplitId: true, amount: true } },
      },
    });
    if (!parent) throw new NotFoundException('Transaction not found');
    if (parent.splitOfId) {
      throw new BadRequestException(
        'This is already a split. Split the transaction it came from instead.',
      );
    }
    const amount = Number(parent.amount);
    // step9 (2026-11-17): the set is the TOP-level splits; the splits cut from a kept one
    // stay with it and still hold their money.
    const kept = new Set(
      input.flatMap((s) =>
        s.id != null ? subtreeIds(parent.splits, s.id).slice(1) : [],
      ),
    );
    const problem = splitProblem(amount, [
      ...input.map((s) => s.amount),
      ...parent.splits
        .filter((s) => kept.has(s.id))
        .map((s) => Math.abs(Number(s.amount))),
    ]);
    if (problem) throw new BadRequestException(problem);

    const existing = new Set(
      parent.splits.filter((s) => s.parentSplitId === null).map((s) => s.id),
    );
    for (const s of input) {
      if (s.id != null && !existing.has(s.id)) {
        throw new BadRequestException('A split was removed meanwhile. Reload.');
      }
    }
    const rows = await Promise.all(
      input.map(async (s) => {
        const category = await this.accounts.validCategory(scope, s.category);
        return {
          id: s.id,
          // step11: a categorized split is never nameless — the parent's name, else its
          // description.
          name: fallbackName(
            cleanName(s.name ?? null) ?? parent.name,
            category,
            parent.description,
          ),
          itemName: cleanName(s.itemName ?? null),
          always: s.always === true,
          category,
          amount: signedLike(amount, s.amount),
        };
      }),
    );

    // The bank side of the parent is the bank side of every split.
    const bank = amount < 0 ? parent.creditAccount : parent.debitAccount;
    const keep = new Set(rows.flatMap((r) => (r.id != null ? [r.id] : [])));
    await this.prisma.$transaction(async (tx) => {
      // A removed split takes the splits cut from it along (the FK cascades).
      await tx.bankTransaction.deleteMany({
        where: {
          splitOfId: parent.id,
          parentSplitId: null,
          id: { notIn: [...keep] },
        },
      });
      const out: number[] = [];
      for (const r of rows) {
        const data = {
          name: r.name,
          itemName: r.itemName,
          amount: r.amount.toFixed(2),
          offsetAccount: r.category,
          // The transaction's sign decides the sides (a split may be $0.00).
          ...doubleEntry(amount, bank, r.category),
        };
        if (r.id != null) {
          await tx.bankTransaction.update({ where: { id: r.id }, data });
          out.push(r.id);
        } else {
          const made = await tx.bankTransaction.create({
            data: {
              ...data,
              statementId: parent.statementId,
              ...scopeWhere(scope),
              position: parent.position,
              pendingDate: parent.pendingDate,
              postingDate: parent.postingDate,
              description: parent.description,
              manualEdit: true,
              splitOfId: parent.id,
            },
            select: { id: true },
          });
          out.push(made.id);
        }
      }
      return out;
    });
    // "Always": this item goes in this category on every later receipt, and the
    // customer's other rows of it move too — the same rule as the Products tab.
    for (const r of rows) {
      if (r.always && r.itemName && itemKey(r.itemName)) {
        await this.products.saveRule(scope, r.itemName, r.category);
      }
    }
    await this.afterChange(scope, id);
  }

  /**
   * step2 (2026-11-15): Split in the ledger = one more split, a copy of the row clicked (its
   * name, category, sub-name and product) at $0.00, filled in place afterwards. Clicked on a
   * split, it copies that split; on a transaction, the transaction.
   * step9 (2026-11-17): clicked on a split, the copy is cut FROM that split
   * (`parentSplitId`) — its money comes out of that split, which keeps its total.
   */
  async duplicate(scope: BookScope, id: number): Promise<{ id: number }> {
    const row = await this.prisma.bankTransaction.findFirst({
      where: { id, ...scopeWhere(scope), statement: DONE_STATEMENT },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    const parent = row.splitOfId
      ? await this.prisma.bankTransaction.findFirst({
          where: { id: row.splitOfId, ...scopeWhere(scope) },
        })
      : row;
    if (!parent) throw new NotFoundException('Transaction not found');
    const amount = Number(parent.amount);
    if (amount === 0) {
      throw new BadRequestException('A $0.00 transaction cannot be split');
    }
    // Every split of the family counts, at any depth.
    const count = await this.prisma.bankTransaction.count({
      where: { splitOfId: parent.id },
    });
    if (count >= 50) {
      throw new BadRequestException('A transaction can have at most 50 splits');
    }
    const bank = amount < 0 ? parent.creditAccount : parent.debitAccount;
    const category = row.offsetAccount;
    const made = await this.prisma.bankTransaction.create({
      data: {
        ...scopeWhere(scope),
        statementId: parent.statementId,
        position: parent.position,
        pendingDate: parent.pendingDate,
        postingDate: parent.postingDate,
        description: parent.description,
        name: fallbackName(row.name, category, parent.description),
        itemName: row.itemName,
        subNameId: row.splitOfId ? row.subNameId : null,
        amount: '0.00',
        offsetAccount: category,
        // The sides follow the transaction's sign, even at $0.00.
        ...doubleEntry(amount, bank, category),
        manualEdit: true,
        splitOfId: parent.id,
        parentSplitId: row.splitOfId ? row.id : null,
      },
      select: { id: true },
    });
    // step9: a copied split keeps its sub-name — the transaction then has one too.
    await this.afterChange(scope, parent.id);
    return made;
  }

  /**
   * step2 (2026-11-15): one split edited in place (`SplitEdit`).
   * - amount: the splits may still not add up to more than the transaction;
   * - name: ONCE = this split only; ALWAYS = the transaction's description goes to the name
   *   (`NameMemoryService`, which asks when another name has it) and everything moves. A new
   *   name brings its own category and leaves the old name's sub-name;
   * - category: ALL = the name's one category (every row of it, the transaction too); SUB =
   *   this split only, under the sub-name "<name> - <category>" (`SubNamesService`). The
   *   name's own category needs no sub-name.
   */
  async edit(scope: BookScope, id: number, input: SplitEdit): Promise<void> {
    const split = await this.findSplit(scope, id);
    const parent = split.splitOf!;
    const parentAmount = Number(parent.amount);
    const bank = parentAmount < 0 ? parent.creditAccount : parent.debitAccount;

    if (input.amount !== undefined && split.parentSplitId !== null) {
      // step9 (2026-11-17): a split of a split moves money from (or back to) that split.
      const from = await this.findSplit(scope, split.parentSplitId);
      const available =
        Math.abs(Number(from.amount)) + Math.abs(Number(split.amount));
      const problem = childSplitProblem(
        available,
        input.amount,
        from.name ?? 'the split',
      );
      if (problem) throw new BadRequestException(problem);
      const left = Math.round((available - input.amount) * 100) / 100;
      await this.prisma.$transaction([
        this.prisma.bankTransaction.update({
          where: { id },
          data: {
            amount: signedLike(parentAmount, input.amount).toFixed(2),
            ...doubleEntry(parentAmount, bank, split.offsetAccount),
          },
        }),
        this.prisma.bankTransaction.update({
          where: { id: from.id },
          data: { amount: signedLike(parentAmount, left).toFixed(2) },
        }),
      ]);
    } else if (input.amount !== undefined) {
      const others = await this.prisma.bankTransaction.findMany({
        where: { splitOfId: parent.id, id: { not: id } },
        select: { amount: true },
      });
      const problem = splitProblem(parentAmount, [
        ...others.map((o) => Math.abs(Number(o.amount))),
        input.amount,
      ]);
      if (problem) throw new BadRequestException(problem);
      const amount = signedLike(parentAmount, input.amount);
      await this.prisma.bankTransaction.update({
        where: { id },
        data: {
          amount: amount.toFixed(2),
          ...doubleEntry(parentAmount, bank, split.offsetAccount),
        },
      });
    }

    if (input.itemName !== undefined) {
      await this.prisma.bankTransaction.update({
        where: { id },
        data: { itemName: cleanName(input.itemName) },
      });
    }

    const name = cleanName(input.name ?? null);
    if (name && name.toLowerCase() !== (split.name ?? '').toLowerCase()) {
      await this.names.editTransaction(scope, id, {
        name,
        category: null,
        scope: input.nameScope ?? 'ONCE',
        replace: input.replace,
      });
      // The new name's own category, unless one is picked below.
      const own = input.category
        ? null
        : await this.names.categoryOfName(scope, name);
      await this.setCategory(scope, id, own, null);
    }

    if (input.category) {
      const category = await this.accounts.validCategory(scope, input.category);
      const current = await this.findSplit(scope, id);
      const owner = cleanName(current.name);
      const ofName = owner
        ? await this.names.categoryOfName(scope, owner)
        : null;
      if (owner && input.categoryScope === 'ALL') {
        await this.names.setCategoryOfName(scope, owner, category);
        await this.setCategory(scope, id, category, null);
      } else if (!owner || category === ofName) {
        await this.setCategory(scope, id, category, null);
      } else {
        const sub = await this.subNames.ensure(scope, owner, category);
        await this.setCategory(scope, id, category, sub.id);
      }
    }

    const itemName =
      input.itemName !== undefined
        ? cleanName(input.itemName)
        : cleanName(split.itemName);
    if (input.always && itemName && itemKey(itemName)) {
      const after = await this.findSplit(scope, id);
      await this.products.saveRule(scope, itemName, after.offsetAccount);
    }
    // step9: a split with a sub-name gives its transaction one too ("<name> - <category>").
    await this.afterChange(scope, parent.id);
  }

  /**
   * step2 (2026-11-15): one split removed; what it took goes back to its transaction.
   * step9 (2026-11-17): the splits cut from it go with it, and a split cut from another
   * split gives all of it back to that split.
   */
  async remove(scope: BookScope, id: number): Promise<void> {
    const split = await this.findSplit(scope, id);
    const family = await this.prisma.bankTransaction.findMany({
      where: { splitOfId: split.splitOfId! },
      select: { id: true, parentSplitId: true, amount: true, subNameId: true },
    });
    const gone = new Set(subtreeIds(family, id));
    const subtree = family.filter((r) => gone.has(r.id));
    const from =
      split.parentSplitId !== null
        ? family.find((r) => r.id === split.parentSplitId)
        : undefined;
    const parentAmount = Number(split.splitOf!.amount);
    const centsOf = (v: { toString(): string }) =>
      Math.abs(Math.round(Number(v) * 100));
    const back = from
      ? centsOf(from.amount) +
        subtree.reduce((n, r) => n + centsOf(r.amount), 0)
      : 0;
    await this.prisma.$transaction([
      ...(from
        ? [
            this.prisma.bankTransaction.update({
              where: { id: from.id },
              data: {
                amount: signedLike(parentAmount, back / 100).toFixed(2),
              },
            }),
          ]
        : []),
      // The FK cascades to the splits cut from it.
      this.prisma.bankTransaction.delete({ where: { id } }),
    ]);
    for (const sub of new Set(subtree.map((r) => r.subNameId)))
      await dropUnusedSubName(this.prisma, scope, sub);
    await this.afterChange(scope, split.splitOfId!);
  }

  /**
   * After any split change: the transaction's own sub-name (step9), then the sub-name rule
   * of its description (step9, 2026-11-17).
   */
  private async afterChange(scope: BookScope, parentId: number): Promise<void> {
    await syncParentSubNames(this.prisma, scope, [parentId]);
    await this.names.syncSubNameRules(scope, [parentId]);
  }

  /**
   * step2 (2026-11-15): a transaction's Product (a one-item receipt fills it with no split);
   * '' clears it.
   */
  async setProduct(
    scope: BookScope,
    id: number,
    itemName: string,
  ): Promise<void> {
    const row = await this.prisma.bankTransaction.findFirst({
      where: { id, ...scopeWhere(scope), statement: DONE_STATEMENT },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    await this.prisma.bankTransaction.update({
      where: { id },
      data: { itemName: cleanName(itemName) },
    });
  }

  private async findSplit(scope: BookScope, id: number) {
    const split = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        ...scopeWhere(scope),
        splitOfId: { not: null },
        statement: DONE_STATEMENT,
      },
      include: { splitOf: true },
    });
    if (!split?.splitOf) throw new NotFoundException('Split not found');
    return split;
  }

  /** A split's category (null = keep it) and sub-name, debit / credit re-derived. */
  private async setCategory(
    scope: BookScope,
    id: number,
    category: string | null,
    subNameId: number | null,
  ): Promise<void> {
    const split = await this.findSplit(scope, id);
    const parentAmount = Number(split.splitOf!.amount);
    const bank =
      parentAmount < 0
        ? split.splitOf!.creditAccount
        : split.splitOf!.debitAccount;
    const offset = category ?? split.offsetAccount;
    await this.prisma.bankTransaction.update({
      where: { id },
      data: {
        offsetAccount: offset,
        ...doubleEntry(parentAmount, bank, offset),
        subNameId,
        name: fallbackName(split.name, offset, split.description),
      },
    });
    if (split.subNameId !== subNameId)
      await dropUnusedSubName(this.prisma, scope, split.subNameId);
  }
}
