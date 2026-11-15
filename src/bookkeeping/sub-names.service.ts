import {
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { doubleEntry } from './ledger.util';
import { NameMemoryService } from './name-memory.service';
import { scopeWhere, type BookScope } from './scope';
import { subNameOf } from './sub-names.util';
import { ensureSubName, syncParentSubNames } from './sub-name-parents';

/** A sub-name as the Names tab shows it under its parent. */
export interface SubNameView {
  id: number;
  /** The parent name, as its `LedgerName` spells it. */
  parent: string;
  /** "Walmart - Maintenance". */
  name: string;
  category: string;
  rows: number;
}

/**
 * step2 (2026-11-15): sub-names. A split the customer moves to another category "only for
 * this" keeps its parent's `name` (so the Names tab, the reports and the chart of accounts
 * still count it under that name) and points at a `SubName` — "<name> - <category>" — whose
 * category it takes. One sub-name per (name, category) in a book; changing a sub-name's
 * category moves every row of it, removing it puts them back in the name's category.
 * step9 (2026-11-15): the transaction a sub-named split came from gets its own sub-name,
 * "<name> - <its category>" (`syncParentSubNames`), so the Names tab lists every part of it.
 */
@Injectable()
export class SubNamesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubNamesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly names: NameMemoryService,
    private readonly accounts: CustomerAccountsService,
  ) {}

  /**
   * step9: transactions split before their own sub-name existed get it — 70 s after start,
   * every book with a sub-named split (idempotent: nothing changes once they have it).
   */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.backfillParents(), 70_000).unref();
  }

  async backfillParents(): Promise<void> {
    try {
      const books = await this.prisma.bankTransaction.groupBy({
        by: ['customerId', 'bookId', 'companyId'],
        where: { splitOfId: { not: null }, subNameId: { not: null } },
      });
      let changed = 0;
      for (const b of books)
        changed += await syncParentSubNames(this.prisma, b);
      if (changed) {
        this.logger.log(
          `gave ${changed} split transaction(s) their own sub-name`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `parent sub-names not synced: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The sub-name of `parent` in `category`, made (with the parent's `LedgerName`) if new. */
  async ensure(
    scope: BookScope,
    parent: string,
    category: string,
  ): Promise<{ id: number; name: string }> {
    return ensureSubName(this.prisma, scope, parent, category);
  }

  /** Every sub-name of the book with its parent and how many rows it has. */
  async list(scope: BookScope): Promise<SubNameView[]> {
    const subs = await this.prisma.subName.findMany({
      where: { bookId: scope.bookId },
      orderBy: { name: 'asc' },
    });
    if (!subs.length) return [];
    const [parents, counts] = await Promise.all([
      this.prisma.ledgerName.findMany({
        where: { id: { in: [...new Set(subs.map((s) => s.nameId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.bankTransaction.groupBy({
        by: ['subNameId'],
        where: {
          ...scopeWhere(scope),
          subNameId: { in: subs.map((s) => s.id) },
          statement: { deletedAt: null },
        },
        _count: { _all: true },
      }),
    ]);
    const parentOf = new Map(parents.map((p) => [p.id, p.name]));
    const rowsOf = new Map(counts.map((c) => [c.subNameId, c._count._all]));
    return subs.flatMap((s) => {
      const parent = parentOf.get(s.nameId);
      return parent
        ? [
            {
              id: s.id,
              parent,
              name: s.name,
              category: s.category,
              rows: rowsOf.get(s.id) ?? 0,
            },
          ]
        : [];
    });
  }

  /**
   * A sub-name's category: renamed to "<parent> - <category>" and every row of it moves.
   * Its parent's own category → the sub-name is no longer needed and goes. Another
   * sub-name of the parent already in that category → the rows join it.
   */
  async setCategory(
    scope: BookScope,
    id: number,
    rawCategory: string,
  ): Promise<void> {
    const sub = await this.get(scope, id);
    const category = await this.accounts.validCategory(scope, rawCategory);
    const parent = await this.parentName(sub.nameId);
    if (
      parent &&
      (await this.names.categoryOfName(scope, parent)) === category
    ) {
      await this.remove(scope, id);
      return;
    }
    const other = await this.prisma.subName.findFirst({
      where: {
        bookId: scope.bookId,
        nameId: sub.nameId,
        category,
        id: { not: id },
      },
      select: { id: true },
    });
    const target = other?.id ?? id;
    if (!other) {
      await this.prisma.subName.update({
        where: { id },
        data: {
          category,
          ...(parent && { name: subNameOf(parent, category) }),
        },
      });
    }
    await this.moveRows(scope, id, target, category);
    if (other) await this.prisma.subName.delete({ where: { id } });
    await syncParentSubNames(this.prisma, scope);
  }

  /** Remove a sub-name: its rows go back to the parent name's category. */
  async remove(scope: BookScope, id: number): Promise<void> {
    const sub = await this.get(scope, id);
    const parent = await this.parentName(sub.nameId);
    const category =
      (parent && (await this.names.categoryOfName(scope, parent))) ??
      sub.category;
    await this.moveRows(scope, id, null, category);
    await this.prisma.subName.delete({ where: { id } });
    await syncParentSubNames(this.prisma, scope);
  }

  private async get(scope: BookScope, id: number) {
    const sub = await this.prisma.subName.findFirst({
      where: { id, bookId: scope.bookId, customerId: scope.customerId },
    });
    if (!sub) throw new NotFoundException('Sub-name not found');
    return sub;
  }

  private async parentName(nameId: number): Promise<string | null> {
    const row = await this.prisma.ledgerName.findUnique({
      where: { id: nameId },
      select: { name: true },
    });
    return row?.name ?? null;
  }

  /** Every row of sub-name `from`: to sub-name `to` (null = none) and `category`. */
  private async moveRows(
    scope: BookScope,
    from: number,
    to: number | null,
    category: string,
  ): Promise<void> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: { ...scopeWhere(scope), subNameId: from },
      select: {
        id: true,
        amount: true,
        debitAccount: true,
        creditAccount: true,
        splitOf: {
          select: { amount: true, debitAccount: true, creditAccount: true },
        },
      },
    });
    if (!rows.length) return;
    await this.prisma.$transaction(
      rows.map((r) => {
        // The bank side never changes; only the offset does. A split's sides follow its
        // transaction's sign (it may be $0.00).
        const of = r.splitOf ?? r;
        const amount = Number(of.amount);
        const bank = amount < 0 ? of.creditAccount : of.debitAccount;
        return this.prisma.bankTransaction.update({
          where: { id: r.id },
          data: {
            subNameId: to,
            offsetAccount: category,
            ...doubleEntry(amount, bank, category),
          },
        });
      }),
    );
  }
}
