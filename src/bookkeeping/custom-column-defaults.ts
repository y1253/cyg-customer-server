import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { scopeWhere, type BookScope } from './scope';

const logger = new Logger('CustomColumnDefaults');

/** Which rows `fillNameAnswers` looks at (absent = every row of the book). */
export interface FillTarget {
  transactionIds?: number[];
  names?: string[];
  subNameIds?: number[];
}

/** One default, as `fillNameAnswers` uses it. */
export interface NameDefault {
  columnId: number;
  /** Lower-cased `LedgerName.name` (null = a sub-name's default). */
  nameKey: string | null;
  subNameId: number | null;
  value: string | null;
  dropDownId: number | null;
}

/**
 * The answer a row gets in one column: its sub-name's default first, else its name's
 * (pure — `fillNameAnswers` and the spec use it).
 */
export function defaultFor(
  defaults: readonly NameDefault[],
  columnId: number,
  row: { name: string | null; subNameId: number | null },
): NameDefault | null {
  const mine = defaults.filter((d) => d.columnId === columnId);
  if (row.subNameId !== null) {
    const sub = mine.find((d) => d.subNameId === row.subNameId);
    if (sub) return sub;
  }
  const key = row.name?.toLowerCase() ?? null;
  return (key !== null && mine.find((d) => d.nameKey === key)) || null;
}

/**
 * step9 (2026-11-19): a name's / sub-name's default answers (`CustomColumnNameAnswer`) fill
 * every EMPTY cell of its rows — a cell with an answer (typed by hand, or filled before) is
 * never overwritten (`skipDuplicates` on the (column, transaction) key). Plain IO on Prisma
 * so it runs wherever rows arrive or change name: `SplitRulesService.applyToNew` (statement
 * reads, bank feeds) and the end of `syncParentSubNames` (every name / category / split
 * change). Never throws. Returns how many cells it filled.
 */
export async function fillNameAnswers(
  prisma: PrismaService,
  scope: BookScope,
  target: FillTarget = {},
): Promise<number> {
  try {
    const rows = await prisma.customColumnNameAnswer.findMany({
      where: {
        column: { ...scopeWhere(scope), deletedAt: null },
        OR: [{ dropDownId: null }, { dropDown: { deletedAt: null } }],
      },
      select: {
        customColumnId: true,
        nameId: true,
        subNameId: true,
        value: true,
        dropDownId: true,
        column: { select: { type: true } },
      },
    });
    // A DROPDOWN default whose option went has nothing to give.
    const usable = rows.filter(
      (r) => r.column.type !== 'DROPDOWN' || r.dropDownId !== null,
    );
    if (!usable.length) return 0;
    const nameIds = [
      ...new Set(usable.flatMap((r) => (r.nameId === null ? [] : [r.nameId]))),
    ];
    const names = nameIds.length
      ? await prisma.ledgerName.findMany({
          where: { ...scopeWhere(scope), id: { in: nameIds } },
          select: { id: true, name: true },
        })
      : [];
    const keyOf = new Map(names.map((n) => [n.id, n.name.toLowerCase()]));
    const defaults: NameDefault[] = usable.flatMap((r) => {
      const nameKey = r.nameId === null ? null : keyOf.get(r.nameId);
      if (nameKey === undefined) return [];
      return [
        {
          columnId: r.customColumnId,
          nameKey,
          subNameId: r.subNameId,
          value: r.value,
          dropDownId: r.dropDownId,
        },
      ];
    });
    if (!defaults.length) return 0;

    let ids = target.transactionIds;
    if (ids) {
      // A split answers for its transaction.
      const own = await prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), id: { in: ids } },
        select: { id: true, splitOfId: true },
      });
      ids = [...new Set(own.map((r) => r.splitOfId ?? r.id))];
      if (!ids.length) return 0;
    }
    const or = [
      ...(target.names?.length ? [{ name: { in: target.names } }] : []),
      ...(target.subNameIds?.length
        ? [{ subNameId: { in: target.subNameIds } }]
        : []),
    ];
    if ((target.names || target.subNameIds) && !or.length) return 0;
    const txs = await prisma.bankTransaction.findMany({
      where: {
        ...scopeWhere(scope),
        splitOfId: null,
        statement: { deletedAt: null },
        ...(ids && { id: { in: ids } }),
        ...(or.length && { OR: or }),
        // MySQL compares names case-insensitively; a row with no name / sub-name has none.
        NOT: { AND: [{ name: null }, { subNameId: null }] },
      },
      select: { id: true, name: true, subNameId: true },
    });
    const columns = [...new Set(defaults.map((d) => d.columnId))];
    const data = txs.flatMap((t) =>
      columns.flatMap((columnId) => {
        const d = defaultFor(defaults, columnId, t);
        return d
          ? [
              {
                customColumnId: columnId,
                transactionId: t.id,
                value: d.value,
                dropDownId: d.dropDownId,
              },
            ]
          : [];
      }),
    );
    if (!data.length) return 0;
    let filled = 0;
    for (let i = 0; i < data.length; i += 1000) {
      const r = await prisma.customColumnAnswer.createMany({
        data: data.slice(i, i + 1000),
        skipDuplicates: true,
      });
      filled += r.count;
    }
    return filled;
  } catch (err) {
    logger.warn(
      `book ${scope.bookId}: name default answers not filled: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * A name's / sub-name's defaults onto another (a rename, a merge): every column the target
 * has no default in takes the source's; the target's own stay. `remove` drops the source's.
 */
export async function moveNameAnswers(
  prisma: PrismaService,
  from: { nameId?: number; subNameId?: number },
  to: { nameId?: number; subNameId?: number },
  remove = false,
): Promise<void> {
  const keyOf = (k: { nameId?: number; subNameId?: number }) => ({
    nameId: k.nameId ?? null,
    subNameId: k.subNameId ?? null,
  });
  const src = await prisma.customColumnNameAnswer.findMany({
    where: keyOf(from),
  });
  if (!src.length) return;
  const dst = keyOf(to);
  const have = await prisma.customColumnNameAnswer.findMany({
    where: dst,
    select: { customColumnId: true },
  });
  const taken = new Set(have.map((h) => h.customColumnId));
  const add = src.filter((s) => !taken.has(s.customColumnId));
  await prisma.$transaction([
    ...(add.length
      ? [
          prisma.customColumnNameAnswer.createMany({
            data: add.map((s) => ({
              customColumnId: s.customColumnId,
              ...dst,
              value: s.value,
              dropDownId: s.dropDownId,
            })),
          }),
        ]
      : []),
    ...(remove
      ? [
          prisma.customColumnNameAnswer.deleteMany({
            where: { id: { in: src.map((s) => s.id) } },
          }),
        ]
      : []),
  ]);
}
