import type { PrismaService } from '../prisma/prisma.service';
import { nameKeyOf } from './attachment-name.util';
import { cleanName } from './name-memory.util';
import { scopeWhere, type BookScope } from './scope';
import { parentSubName, subNameOf } from './sub-names.util';

/**
 * The sub-name of `parent` in `category`, made (with the parent's `LedgerName`) if new.
 * Plain IO on Prisma so `NameMemoryService` (which `SubNamesService` depends on) can use it.
 */
export async function ensureSubName(
  prisma: PrismaService,
  scope: BookScope,
  parent: string,
  category: string,
): Promise<{ id: number; name: string }> {
  const nameId = await ledgerNameId(prisma, scope, parent);
  const found = await prisma.subName.findFirst({
    where: { bookId: scope.bookId, nameId, category },
    select: { id: true, name: true },
  });
  if (found) return found;
  return prisma.subName.create({
    data: {
      ...scopeWhere(scope),
      nameId,
      name: subNameOf(parent, category),
      category,
    },
    select: { id: true, name: true },
  });
}

/** The name's `LedgerName` id — the row is made when the name has none yet. */
export async function ledgerNameId(
  prisma: PrismaService,
  scope: BookScope,
  name: string,
): Promise<number> {
  const clean = cleanName(name) ?? name;
  // MySQL compares names case-insensitively, as the unique key does.
  const found = await prisma.ledgerName.findFirst({
    where: { ...scopeWhere(scope), name: clean },
    select: { id: true },
  });
  if (found) return found.id;
  const made = await prisma.ledgerName.create({
    data: { ...scopeWhere(scope), name: clean },
    select: { id: true },
  });
  return made.id;
}

/**
 * A sub-name no row points at any more is removed (a split deleted or moved out of it).
 * Counted within its book, so `idx_bank_transaction_sub_name (bookId, subNameId)` serves it.
 */
export async function dropUnusedSubName(
  prisma: PrismaService,
  scope: BookScope,
  id: number | null,
): Promise<void> {
  if (!id) return;
  const used = await prisma.bankTransaction.count({
    where: { bookId: scope.bookId, subNameId: id },
  });
  if (!used) await deleteSubName(prisma, id);
}

/**
 * step9 part 3: a sub-name is deleted with its own settings — its agency picks (keyed by
 * its name) go, and the files filed under it go back to its parent name.
 */
export async function deleteSubName(
  prisma: PrismaService,
  id: number,
): Promise<void> {
  const sub = await prisma.subName.findUnique({ where: { id } });
  if (!sub) return;
  const parent = await prisma.ledgerName.findUnique({
    where: { id: sub.nameId },
    select: { name: true },
  });
  // MySQL compares names case-insensitively.
  await prisma.$transaction([
    prisma.ledgerNameAgency.deleteMany({
      where: { bookId: sub.bookId, name: sub.name },
    }),
    ...(parent
      ? [
          prisma.transactionAttachment.updateMany({
            where: { bookId: sub.bookId, nameOverride: sub.name },
            data: { nameOverride: parent.name },
          }),
          prisma.nameFolder.updateMany({
            where: { bookId: sub.bookId, name: nameKeyOf(sub.name) },
            data: { name: nameKeyOf(parent.name) },
          }),
        ]
      : []),
    prisma.subName.deleteMany({ where: { id } }),
  ]);
}

/**
 * step9 (2026-11-15): every split transaction of the book (or only `parentIds`) gets the
 * sub-name "<its name> - <its category>" while one of its splits has a sub-name, and loses it
 * when none has (`parentSubName`). A sub-name left with no row is removed. Run after every
 * split, sub-name and name / category change (`SplitsService`, `SubNamesService`,
 * `NameMemoryService.syncProvenance`). Returns how many transactions changed.
 */
export async function syncParentSubNames(
  prisma: PrismaService,
  scope: BookScope,
  parentIds?: number[],
): Promise<number> {
  const parents = await prisma.bankTransaction.findMany({
    where: {
      ...scopeWhere(scope),
      splitOfId: null,
      ...(parentIds && { id: { in: parentIds } }),
      OR: [
        { subNameId: { not: null } },
        { splits: { some: { subNameId: { not: null } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      offsetAccount: true,
      subNameId: true,
      splits: { where: { subNameId: { not: null } }, select: { id: true } },
    },
  });
  if (!parents.length) return 0;
  const currentIds = [
    ...new Set(parents.flatMap((p) => (p.subNameId ? [p.subNameId] : []))),
  ];
  const subs = currentIds.length
    ? await prisma.subName.findMany({
        where: { id: { in: currentIds } },
        select: { id: true, nameId: true, category: true },
      })
    : [];
  const names = subs.length
    ? await prisma.ledgerName.findMany({
        where: { id: { in: [...new Set(subs.map((s) => s.nameId))] } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const subOf = new Map(subs.map((s) => [s.id, s]));
  const dropped = new Set<number>();
  let changed = 0;
  for (const p of parents) {
    const sub = p.subNameId ? subOf.get(p.subNameId) : undefined;
    const parent = sub ? nameOf.get(sub.nameId) : undefined;
    const plan = parentSubName({
      name: cleanName(p.name),
      category: p.offsetAccount,
      hasSubSplits: p.splits.length > 0,
      current: sub && parent ? { parent, category: sub.category } : null,
    });
    if (!plan.change) continue;
    const next = plan.want
      ? (
          await ensureSubName(
            prisma,
            scope,
            plan.want.parent,
            plan.want.category,
          )
        ).id
      : null;
    if (next === p.subNameId) continue;
    await prisma.bankTransaction.update({
      where: { id: p.id },
      data: { subNameId: next },
    });
    if (p.subNameId) dropped.add(p.subNameId);
    changed++;
  }
  // A sub-name only the transaction had (none of its splits) goes with it.
  for (const id of dropped) {
    const used = await prisma.bankTransaction.count({
      where: { bookId: scope.bookId, subNameId: id },
    });
    if (!used) await deleteSubName(prisma, id);
  }
  return changed;
}
