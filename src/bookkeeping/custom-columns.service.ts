import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fillNameAnswers } from './custom-column-defaults';
import {
  answerProblem,
  cleanColumn,
  MAX_CUSTOM_COLUMNS,
  storedAnswerFit,
  type ColumnInput,
  type CustomColumnType,
} from './custom-column.util';
import { nameKey } from './name-memory.util';
import { scopeWhere, type BookScope } from './scope';
import { refuseWrapper, ledgerNameId } from './sub-name-parents';
import { UNCLARIFIED_NAME } from './reports.util';

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

/**
 * step9 (2026-11-19): a name's (`name`) or a sub-name's (`subNameId`) default answer in a
 * column — it fills every empty cell of its rows.
 */
export interface CustomNameAnswerView extends CustomAnswerView {
  columnId: number;
  name: string | null;
  subNameId: number | null;
}

export interface CustomColumnsView {
  columns: CustomColumnView[];
  /** transactionId → columnId → answer. */
  answers: Record<number, Record<number, CustomAnswerView>>;
  /** step9 (2026-11-19): the names' / sub-names' default answers. */
  nameAnswers: CustomNameAnswerView[];
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
 * sit on the row — step9 (2026-11-19): a split is its own row with its own answers. Rules:
 * `custom-column.util.ts`.
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
            // step9 part 3: only rows still in the ledger (as the rule check counts them).
            transaction: {
              ...scopeWhere(scope),
              statement: { deletedAt: null },
            },
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
    return {
      columns,
      answers,
      nameAnswers: await this.nameAnswers(scope, columns),
      templates: await this.templates(scope),
    };
  }

  private async nameAnswers(
    scope: BookScope,
    columns: CustomColumnView[],
  ): Promise<CustomNameAnswerView[]> {
    if (!columns.length) return [];
    const rows = await this.prisma.customColumnNameAnswer.findMany({
      where: { customColumnId: { in: columns.map((c) => c.id) } },
      select: {
        customColumnId: true,
        nameId: true,
        subNameId: true,
        value: true,
        dropDownId: true,
      },
    });
    const nameIds = rows.flatMap((r) => (r.nameId === null ? [] : [r.nameId]));
    const names = nameIds.length
      ? await this.prisma.ledgerName.findMany({
          where: { ...scopeWhere(scope), id: { in: nameIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return rows.flatMap((r) => {
      const name = r.nameId === null ? null : nameOf.get(r.nameId);
      if (name === undefined) return [];
      return [
        {
          columnId: r.customColumnId,
          name,
          subNameId: r.subNameId,
          value: r.value,
          dropDownId: r.dropDownId,
        },
      ];
    });
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
   * Name, rules and options. step9 part 3 (2026-11-15, user's decision): new rules that an
   * answer already entered breaks are REFUSED — 400 with `problems` (the rows to fix, first
   * 50) and `total`; nothing is saved. A text answer that names a new dropdown option is
   * re-pointed to it. `required` never blocks (an empty cell already shows "Required").
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
    const repoint = await this.checkAnswers(
      row.id,
      {
        ...c,
        options: c.options.map((o) => ({
          ...o,
          id: o.id && keep.has(o.id) ? o.id : undefined,
        })),
      },
      new Set(had.map((h) => h.id)),
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
    if (c.type === 'DROPDOWN' && repoint.length) {
      const options = await this.prisma.customColumnDropDown.findMany({
        where: { customColumnId: row.id, deletedAt: null },
        select: { id: true, label: true },
      });
      for (const r of repoint) {
        const o = options.find((x) => x.label === r.label);
        if (o)
          await this.prisma.customColumnAnswer.update({
            where: { id: r.id },
            data: { dropDownId: o.id, value: o.label },
          });
      }
    }
    await this.fitNameAnswers(row.id, c);
  }

  /**
   * step9 (2026-11-19): the names' default answers after a column's rules change — a text
   * default naming a new option is re-pointed to it; one the new rules refuse (or whose
   * option went) is dropped (a default is not a ledger row, so it never blocks a save).
   */
  private async fitNameAnswers(
    columnId: number,
    col: Parameters<typeof storedAnswerFit>[0],
  ): Promise<void> {
    const rows = await this.prisma.customColumnNameAnswer.findMany({
      where: { customColumnId: columnId },
      select: { id: true, value: true, dropDownId: true },
    });
    if (!rows.length) return;
    const options =
      col.type === 'DROPDOWN'
        ? await this.prisma.customColumnDropDown.findMany({
            where: { customColumnId: columnId, deletedAt: null },
            select: { id: true, label: true },
          })
        : [];
    const drop: number[] = [];
    for (const r of rows) {
      const text = (r.value ?? '').trim();
      if (col.type === 'DROPDOWN') {
        if (options.some((o) => o.id === r.dropDownId)) continue;
        const o = options.find(
          (x) => x.label.trim().toLowerCase() === text.toLowerCase(),
        );
        if (o && text)
          await this.prisma.customColumnNameAnswer.update({
            where: { id: r.id },
            data: { dropDownId: o.id, value: o.label },
          });
        else drop.push(r.id);
      } else if (!text || answerProblem(col, text)) drop.push(r.id);
      else if (r.dropDownId !== null)
        await this.prisma.customColumnNameAnswer.update({
          where: { id: r.id },
          data: { dropDownId: null },
        });
    }
    if (drop.length)
      await this.prisma.customColumnNameAnswer.deleteMany({
        where: { id: { in: drop } },
      });
  }

  /**
   * The column's stored answers against its new rules: throws the rows that break them;
   * returns the text answers to re-point to a new dropdown option of the same label.
   */
  private async checkAnswers(
    columnId: number,
    col: Parameters<typeof storedAnswerFit>[0],
    liveBefore: ReadonlySet<number>,
  ): Promise<Array<{ id: number; label: string }>> {
    const answers = await this.prisma.customColumnAnswer.findMany({
      where: { customColumnId: columnId },
      select: {
        id: true,
        value: true,
        dropDownId: true,
        transaction: {
          select: {
            id: true,
            description: true,
            name: true,
            postingDate: true,
            pendingDate: true,
            statement: { select: { deletedAt: true } },
          },
        },
      },
      orderBy: { transactionId: 'asc' },
    });
    const problems: Array<{
      transactionId: number;
      date: string | null;
      description: string;
      value: string;
      problem: string;
    }> = [];
    const repoint: Array<{ id: number; label: string }> = [];
    for (const a of answers) {
      // An answer on a deleted statement's row is not in the ledger: it never blocks.
      if (a.transaction.statement.deletedAt) continue;
      const fit = storedAnswerFit(col, a, liveBefore);
      if (fit.label) repoint.push({ id: a.id, label: fit.label });
      if (!fit.problem) continue;
      const t = a.transaction;
      const day = t.postingDate ?? t.pendingDate;
      problems.push({
        transactionId: t.id,
        date: day ? day.toISOString().slice(0, 10) : null,
        description: t.name ?? t.description,
        value: a.value ?? '',
        problem: fit.problem,
      });
    }
    if (problems.length) {
      const n = problems.length;
      throw new BadRequestException({
        statusCode: 400,
        message: `${n} answer${n === 1 ? '' : 's'} already in this column ${n === 1 ? 'does' : 'do'} not fit the new rules — fix ${n === 1 ? 'it' : 'them'} first, or keep the old rules`,
        total: n,
        problems: problems.slice(0, 50),
      });
    }
    return repoint;
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
   * One cell, or the same answer on many rows (the AI). A split answers for itself (step9,
   * 2026-11-19 — no longer for its parent). Empty value and no option = cleared.
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
    const { value, dropDownId } = await this.checkedValue(col, input);
    const rows = await this.prisma.bankTransaction.findMany({
      where: { ...scopeWhere(scope), id: { in: transactionIds } },
      select: { id: true },
    });
    if (!rows.length) throw new NotFoundException('Transaction not found');
    const ids = rows.map((r) => r.id);
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

  /**
   * step9 (2026-11-19): the default answer of a name (`name`) or a sub-name (`subNameId`) in
   * a column — checked like a cell; empty = removed. It fills every EMPTY cell of its rows at
   * once (and of every row that gets it later); answers already there stay. A name with
   * sub-names is only a wrapper: its defaults go on its sub-names. Returns how many cells
   * it filled.
   */
  async setNameAnswer(
    scope: BookScope,
    columnId: number,
    target: { name?: string; subNameId?: number },
    input: { value?: string | null; dropDownId?: number | null; option?: string },
  ): Promise<number> {
    const col = await this.owned(scope, columnId);
    const { value, dropDownId } = await this.checkedValue(col, input);
    let key: { nameId: number | null; subNameId: number | null };
    let fill: { names?: string[]; subNameIds?: number[] };
    if (target.subNameId) {
      const sub = await this.prisma.subName.findFirst({
        where: { id: target.subNameId, bookId: scope.bookId },
        select: { id: true },
      });
      if (!sub) throw new NotFoundException('Sub-name not found');
      key = { nameId: null, subNameId: sub.id };
      fill = { subNameIds: [sub.id] };
    } else {
      const name = target.name?.replace(/\s+/g, ' ').trim();
      if (!name || nameKey(name) === nameKey(UNCLARIFIED_NAME))
        throw new BadRequestException('Pick a name');
      await refuseWrapper(this.prisma, scope, name);
      const nameId =
        value === null
          ? (
              await this.prisma.ledgerName.findFirst({
                where: { ...scopeWhere(scope), name },
                select: { id: true },
              })
            )?.id
          : await ledgerNameId(this.prisma, scope, name);
      if (nameId === undefined) return 0;
      key = { nameId, subNameId: null };
      fill = { names: [name] };
    }
    // NULL never equals NULL in the unique key: find, then update / create.
    const found = await this.prisma.customColumnNameAnswer.findFirst({
      where: { customColumnId: col.id, ...key },
      select: { id: true },
    });
    if (value === null) {
      if (found)
        await this.prisma.customColumnNameAnswer.delete({
          where: { id: found.id },
        });
      return 0;
    }
    if (found)
      await this.prisma.customColumnNameAnswer.update({
        where: { id: found.id },
        data: { value, dropDownId },
      });
    else
      await this.prisma.customColumnNameAnswer.create({
        data: { customColumnId: col.id, ...key, value, dropDownId },
      });
    return fillNameAnswers(this.prisma, scope, fill);
  }

  /** One answer checked against its column's rules: the value (and option) to store. */
  private async checkedValue(
    col: { id: number; name: string; type: string; minChars: number | null; maxChars: number | null },
    input: { value?: string | null; dropDownId?: number | null; option?: string },
  ): Promise<{ value: string | null; dropDownId: number | null }> {
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
    return { value, dropDownId };
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
