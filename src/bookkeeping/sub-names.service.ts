import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma, StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import type { NameFieldDto } from './dto/agency.dto';
import { doubleEntry } from './ledger.util';
import { NameMemoryService } from './name-memory.service';
import { nameKey } from './name-memory.util';
import { scopeWhere, type BookScope } from './scope';
import { remainderOf, splitTotals } from './splits.util';
import { subNameOf } from './sub-names.util';
import {
  deleteSubName,
  ensureSubName,
  syncParentSubNames,
} from './sub-name-parents';
import {
  cleanNameFields,
  parseNameFields,
  TaxService,
  type NameField,
} from './tax.service';
import { nameTaxKey } from './tax.util';

/** A sub-name as the Names tab shows it under its parent. */
export interface SubNameView {
  id: number;
  /** The parent name, as its `LedgerName` spells it. */
  parent: string;
  /** "Walmart - Maintenance". */
  name: string;
  category: string;
  rows: number;
  /**
   * step9 (2026-11-15): Σ of its money, in the bank's sign — a row its own share (a split its
   * amount, a transaction what its splits leave).
   */
  total: number;
  /**
   * step9 part 3 (2026-11-15): every setting a name has. `group` null = the parent's;
   * `renamed` = the customer named it (a category change keeps the name); `ownAgencies` =
   * split by `agencyIds` (its own split rules, step9 part 4), else by the parent's.
   */
  group: string | null;
  fields: NameField[];
  renamed: boolean;
  ownAgencies: boolean;
  agencyIds: number[];
}

/** step9 part 3: what `PATCH sub-names/:id/settings` may change (absent = unchanged). */
export interface SubNameSettings {
  /** '' = back to "<parent> - <category>". */
  name?: string;
  group?: string | null;
  fields?: NameFieldDto[];
  /** null = follow the parent's split rules again; [] = none. */
  agencyIds?: number[] | null;
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
    private readonly tax: TaxService,
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

  /** Every sub-name of the book with its parent, how many rows it has and its total. */
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
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: { ...scopeWhere(scope), agency: { deletedAt: null } },
      select: { name: true, agencyId: true },
      orderBy: { agencyId: 'asc' },
    });
    const picksOf = (name: string) =>
      picks
        .filter((p) => nameTaxKey(p.name) === nameTaxKey(name))
        .map((p) => p.agencyId);
    const rowTotals = await this.rowTotals(
      scope,
      subs.map((s) => s.id),
    );
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
              total: (rowTotals.get(s.id) ?? 0) / 100,
              group: s.group,
              fields: parseNameFields(s.fields),
              renamed: s.renamed,
              ownAgencies: s.ownAgencies,
              agencyIds: s.ownAgencies ? picksOf(s.name) : [],
            },
          ]
        : [];
    });
  }

  /**
   * Per sub-name: Σ of its rows' own shares in cents — a split its amount, a transaction
   * what its splits leave (`remainderOf`, the Names tab's rule) — so nothing counts twice.
   */
  private async rowTotals(
    scope: BookScope,
    ids: number[],
  ): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!ids.length) return out;
    const read = { deletedAt: null, status: StatementStatus.DONE };
    const rows = await this.prisma.bankTransaction.findMany({
      where: { ...scopeWhere(scope), subNameId: { in: ids }, statement: read },
      select: { id: true, amount: true, splitOfId: true, subNameId: true },
    });
    const parentIds = rows.filter((r) => r.splitOfId === null).map((r) => r.id);
    const splits = parentIds.length
      ? await this.prisma.bankTransaction.findMany({
          where: { ...scopeWhere(scope), splitOfId: { in: parentIds } },
          select: { amount: true, splitOfId: true },
        })
      : [];
    const totals = splitTotals(
      splits.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })),
    );
    for (const r of rows) {
      const cents = Math.round(
        remainderOf({ ...r, amount: Number(r.amount) }, totals) * 100,
      );
      out.set(r.subNameId!, (out.get(r.subNameId!) ?? 0) + cents);
    }
    return out;
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
      // step9 part 3: a name the customer gave it stays; its settings follow a new one.
      const name =
        parent && !sub.renamed ? subNameOf(parent, category) : sub.name;
      await this.prisma.subName.update({
        where: { id },
        data: { category, name },
      });
      await this.tax.moveSubNameKeys(scope, sub.name, name);
    }
    await this.moveRows(scope, id, target, category);
    if (other) {
      // Joining another sub-name: its own settings win; this one's fill what it lacks.
      const into = await this.get(scope, other.id);
      await this.prisma.subName.update({
        where: { id: into.id },
        data: {
          ...(!into.group && sub.group && { group: sub.group }),
          ...(into.fields == null &&
            sub.fields != null && {
              fields: sub.fields as Prisma.InputJsonValue,
            }),
        },
      });
      await this.tax.moveSubNameKeys(scope, sub.name, into.name);
      await this.prisma.subName.delete({ where: { id } });
    }
    await syncParentSubNames(this.prisma, scope);
  }

  /**
   * step9 part 3 (user: "a subname should have all the settings like a regular name has"):
   * its own name, group, profile and split rules (step9 part 4: a rule given to it splits
   * its rows once, now). Its folder is keyed by its name like a name's (files / folders
   * follow a rename).
   */
  async setSettings(
    scope: BookScope,
    id: number,
    input: SubNameSettings,
  ): Promise<void> {
    const sub = await this.get(scope, id);
    const parent = await this.parentName(sub.nameId);
    let name = sub.name;
    const data: Prisma.SubNameUpdateInput = {};
    if (input.name !== undefined) {
      const auto = subNameOf(parent ?? sub.name, sub.category);
      const typed = input.name.replace(/\s+/g, ' ').trim().slice(0, 191);
      name = typed || auto;
      if (nameKey(name) !== nameKey(sub.name))
        await this.refuseTaken(scope, name, id);
      data.name = name;
      data.renamed = nameKey(name) !== nameKey(auto);
    }
    if (input.group !== undefined) {
      await this.tax.checkGroup(scope, input.group);
      data.group = input.group;
    }
    if (input.fields !== undefined) data.fields = cleanNameFields(input.fields);
    if (input.agencyIds !== undefined)
      data.ownAgencies = input.agencyIds !== null;
    await this.prisma.subName.update({ where: { id }, data });
    if (name !== sub.name)
      await this.tax.moveSubNameKeys(scope, sub.name, name);
    if (input.agencyIds !== undefined)
      await this.tax.writePicks(scope, name, input.agencyIds ?? []);
  }

  /** A sub-name's own name may not be another name's or sub-name's of the book. */
  private async refuseTaken(
    scope: BookScope,
    name: string,
    id: number,
  ): Promise<void> {
    // MySQL compares names case-insensitively.
    const [asName, asSub] = await Promise.all([
      this.prisma.ledgerName.findFirst({
        where: { ...scopeWhere(scope), name },
        select: { id: true },
      }),
      this.prisma.subName.findFirst({
        where: { bookId: scope.bookId, name, id: { not: id } },
        select: { id: true },
      }),
    ]);
    const used =
      asName ||
      asSub ||
      (await this.prisma.bankTransaction.findFirst({
        where: { ...scopeWhere(scope), name },
        select: { id: true },
      }));
    if (used)
      throw new BadRequestException(
        `“${name}” is already a name — pick another`,
      );
  }

  /** Remove a sub-name: its rows go back to the parent name's category. */
  async remove(scope: BookScope, id: number): Promise<void> {
    const sub = await this.get(scope, id);
    const parent = await this.parentName(sub.nameId);
    const category =
      (parent && (await this.names.categoryOfName(scope, parent))) ??
      sub.category;
    await this.moveRows(scope, id, null, category);
    await deleteSubName(this.prisma, id);
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
