import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  answerProblem,
  cleanColumn,
  MAX_CUSTOM_COLUMNS,
  type ColumnInput,
  type CustomColumnType,
} from './custom-column.util';
import { scopeWhere, type BookScope } from './scope';

export interface CustomColumnView {
  id: number;
  name: string;
  type: CustomColumnType;
  minChars: number | null;
  maxChars: number | null;
  required: boolean;
  options: Array<{ id: number; label: string }>;
}

/** A cell: the typed value, or the picked option (with its label). */
export interface CustomAnswerView {
  value: string | null;
  dropDownId: number | null;
}

export interface CustomColumnsView {
  columns: CustomColumnView[];
  /** transactionId → columnId → answer. */
  answers: Record<number, Record<number, CustomAnswerView>>;
  /** The customer's OTHER books that have columns — offered as "same as …" (user's request). */
  templates: Array<{
    bookId: number;
    bookName: string;
    columns: Array<{ name: string; type: CustomColumnType; options: number }>;
  }>;
}

/**
 * step8 (2026-11-11): the customer's own ledger columns, per book (user's decision: per
 * company, with the columns of their other companies offered when they make one). Answers
 * sit on the transaction (a split / tax line shows its parent's). Rules: `custom-column.util.ts`.
 */
@Injectable()
export class CustomColumnsService {
  constructor(private readonly prisma: PrismaService) {}

  async view(scope: BookScope): Promise<CustomColumnsView> {
    const columns = await this.columns(scope);
    const rows = columns.length
      ? await this.prisma.customColumnAnswer.findMany({
          where: {
            customColumnId: { in: columns.map((c) => c.id) },
            transaction: { ...scopeWhere(scope) },
          },
          select: {
            customColumnId: true,
            transactionId: true,
            value: true,
            dropDownId: true,
          },
        })
      : [];
    const answers: CustomColumnsView['answers'] = {};
    for (const r of rows) {
      (answers[r.transactionId] ??= {})[r.customColumnId] = {
        value: r.value,
        dropDownId: r.dropDownId,
      };
    }
    return { columns, answers, templates: await this.templates(scope) };
  }

  async columns(scope: BookScope): Promise<CustomColumnView[]> {
    const rows = await this.prisma.customColumn.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        options: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, label: true },
        },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type as CustomColumnType,
      minChars: c.minChars,
      maxChars: c.maxChars,
      required: c.required,
      options: c.options,
    }));
  }

  private async templates(
    scope: BookScope,
  ): Promise<CustomColumnsView['templates']> {
    const rows = await this.prisma.customColumn.findMany({
      where: {
        customerId: scope.customerId,
        bookId: { not: scope.bookId },
        deletedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        bookId: true,
        name: true,
        type: true,
        _count: { select: { options: { where: { deletedAt: null } } } },
      },
    });
    if (!rows.length) return [];
    const books = await this.prisma.book.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.bookId))] },
        customerId: scope.customerId,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    return books.map((b) => ({
      bookId: b.id,
      bookName: b.name,
      columns: rows
        .filter((r) => r.bookId === b.id)
        .map((r) => ({
          name: r.name,
          type: r.type as CustomColumnType,
          options: r._count.options,
        })),
    }));
  }

  private clean(input: ColumnInput) {
    const clean = cleanColumn(input);
    if (typeof clean === 'string') throw new BadRequestException(clean);
    return clean;
  }

  private async nameTaken(scope: BookScope, name: string, except?: number) {
    const same = await this.prisma.customColumn.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      select: { id: true, name: true },
    });
    return same.some(
      (c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase(),
    );
  }

  async create(scope: BookScope, input: ColumnInput): Promise<void> {
    const c = this.clean(input);
    const count = await this.prisma.customColumn.count({
      where: { ...scopeWhere(scope), deletedAt: null },
    });
    if (count >= MAX_CUSTOM_COLUMNS) {
      throw new BadRequestException(
        `A book has at most ${MAX_CUSTOM_COLUMNS} columns of your own`,
      );
    }
    if (await this.nameTaken(scope, c.name)) {
      throw new BadRequestException(`There is already a column “${c.name}”`);
    }
    await this.prisma.customColumn.create({
      data: {
        ...scopeWhere(scope),
        name: c.name,
        type: c.type,
        minChars: c.minChars,
        maxChars: c.maxChars,
        required: c.required,
        sortOrder: count,
        options: {
          create: c.options.map((o, i) => ({ label: o.label, sortOrder: i })),
        },
      },
    });
  }

  private async owned(scope: BookScope, id: number) {
    const row = await this.prisma.customColumn.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!row) throw new NotFoundException('Column not found');
    return row;
  }

  /**
   * Name, rules and options. A changed type keeps the answers only when they still fit
   * (answers that break the new rules stay stored but the cell shows them as wrong).
   */
  async update(
    scope: BookScope,
    id: number,
    input: ColumnInput,
  ): Promise<void> {
    const row = await this.owned(scope, id);
    const c = this.clean(input);
    if (await this.nameTaken(scope, c.name, id)) {
      throw new BadRequestException(`There is already a column “${c.name}”`);
    }
    const had = await this.prisma.customColumnDropDown.findMany({
      where: { customColumnId: row.id, deletedAt: null },
      select: { id: true },
    });
    const keep = new Set(
      c.options.flatMap((o) =>
        o.id && had.some((h) => h.id === o.id) ? [o.id] : [],
      ),
    );
    await this.prisma.$transaction([
      this.prisma.customColumn.update({
        where: { id: row.id },
        data: {
          name: c.name,
          type: c.type,
          minChars: c.minChars,
          maxChars: c.maxChars,
          required: c.required,
        },
      }),
      this.prisma.customColumnDropDown.updateMany({
        where: {
          customColumnId: row.id,
          deletedAt: null,
          id: { notIn: [...keep] },
        },
        data: { deletedAt: new Date() },
      }),
      ...c.options.map((o, i) =>
        o.id && keep.has(o.id)
          ? this.prisma.customColumnDropDown.update({
              where: { id: o.id },
              data: { label: o.label, sortOrder: i },
            })
          : this.prisma.customColumnDropDown.create({
              data: { customColumnId: row.id, label: o.label, sortOrder: i },
            }),
      ),
    ]);
  }

  async remove(scope: BookScope, id: number): Promise<void> {
    const row = await this.owned(scope, id);
    await this.prisma.customColumn.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
  }

  async reorder(scope: BookScope, ids: number[]): Promise<void> {
    const mine = await this.prisma.customColumn.findMany({
      where: { ...scopeWhere(scope), deletedAt: null, id: { in: ids } },
      select: { id: true },
    });
    const ok = new Set(mine.map((m) => m.id));
    await this.prisma.$transaction(
      ids
        .filter((i) => ok.has(i))
        .map((i, n) =>
          this.prisma.customColumn.update({
            where: { id: i },
            data: { sortOrder: n },
          }),
        ),
    );
  }

  /** "Same as <other company>": its columns and options, except names this book already has. */
  async copy(scope: BookScope, fromBookId: number): Promise<number> {
    if (fromBookId === scope.bookId) return 0;
    const book = await this.prisma.book.findFirst({
      where: { id: fromBookId, customerId: scope.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!book) throw new NotFoundException('Company not found');
    const from = await this.prisma.customColumn.findMany({
      where: { customerId: scope.customerId, bookId: book.id, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        options: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const have = await this.columns(scope);
    const taken = new Set(have.map((c) => c.name.toLowerCase()));
    let n = have.length;
    let copied = 0;
    for (const c of from) {
      if (taken.has(c.name.toLowerCase()) || n >= MAX_CUSTOM_COLUMNS) continue;
      await this.prisma.customColumn.create({
        data: {
          ...scopeWhere(scope),
          name: c.name,
          type: c.type,
          minChars: c.minChars,
          maxChars: c.maxChars,
          required: c.required,
          sortOrder: n++,
          options: {
            create: c.options.map((o) => ({
              label: o.label,
              sortOrder: o.sortOrder,
            })),
          },
        },
      });
      copied++;
    }
    return copied;
  }

  /**
   * One cell, or the same answer on many rows (the AI). A split / tax line answers for its
   * parent. Empty value and no option = cleared.
   */
  async answer(
    scope: BookScope,
    transactionIds: number[],
    columnId: number,
    input: {
      value?: string | null;
      dropDownId?: number | null;
      option?: string;
    },
  ): Promise<number> {
    const col = await this.owned(scope, columnId);
    const rules = {
      type: col.type as CustomColumnType,
      minChars: col.minChars,
      maxChars: col.maxChars,
    };
    let value: string | null = null;
    let dropDownId: number | null = null;
    if (rules.type === 'DROPDOWN') {
      const options = await this.prisma.customColumnDropDown.findMany({
        where: { customColumnId: col.id, deletedAt: null },
        select: { id: true, label: true },
      });
      const wanted = input.option?.trim().toLowerCase();
      const pick = input.dropDownId
        ? options.find((o) => o.id === input.dropDownId)
        : wanted
          ? options.find((o) => o.label.toLowerCase() === wanted)
          : null;
      if ((input.dropDownId || wanted) && !pick) {
        throw new BadRequestException(
          `Pick one of: ${options.map((o) => o.label).join(', ')}`,
        );
      }
      if (pick) {
        dropDownId = pick.id;
        value = pick.label;
      }
    } else {
      const raw = (input.value ?? input.option ?? '').trim();
      const problem = answerProblem(rules, raw);
      if (problem) throw new BadRequestException(`${col.name}: ${problem}`);
      value = raw || null;
    }
    const rows = await this.prisma.bankTransaction.findMany({
      where: { ...scopeWhere(scope), id: { in: transactionIds } },
      select: { id: true, splitOfId: true },
    });
    if (!rows.length) throw new NotFoundException('Transaction not found');
    const ids = [...new Set(rows.map((r) => r.splitOfId ?? r.id))];
    if (value === null) {
      await this.prisma.customColumnAnswer.deleteMany({
        where: { customColumnId: col.id, transactionId: { in: ids } },
      });
      return ids.length;
    }
    await this.prisma.$transaction(
      ids.map((transactionId) =>
        this.prisma.customColumnAnswer.upsert({
          where: {
            customColumnId_transactionId: {
              customColumnId: col.id,
              transactionId,
            },
          },
          create: { customColumnId: col.id, transactionId, value, dropDownId },
          update: { value, dropDownId },
        }),
      ),
    );
    return ids.length;
  }

  /** For the exports: transactionId → the cell texts, in column order. */
  async exportCells(
    scope: BookScope,
  ): Promise<{ columns: CustomColumnView[]; cells: Map<number, string[]> }> {
    const v = await this.view(scope);
    const cells = new Map<number, string[]>();
    for (const [tx, byCol] of Object.entries(v.answers)) {
      cells.set(
        Number(tx),
        v.columns.map((c) => {
          const a = byCol[c.id];
          if (!a) return '';
          if (c.type === 'DROPDOWN') {
            return c.options.find((o) => o.id === a.dropDownId)?.label ?? '';
          }
          return a.value ?? '';
        }),
      );
    }
    return { columns: v.columns, cells };
  }
}
