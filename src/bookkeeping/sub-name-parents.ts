import type { PrismaService } from '../prisma/prisma.service';
import { cleanName } from './name-memory.util';
import { UNCLARIFIED_NAME } from './reports.util';
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

/** A sub-name no row points at any more is removed (a split deleted or moved out of it). */
export async function dropUnusedSubName(
  prisma: PrismaService,
  id: number | null,
): Promise<void> {
  if (!id) return;
  const used = await prisma.bankTransaction.count({ where: { subNameId: id } });
  if (!used) await prisma.subName.deleteMany({ where: { id } });
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
      where: { subNameId: id },
    });
    if (!used) await prisma.subName.deleteMany({ where: { id } });
  }
  return changed;
}

/**
 * step9 (2026-11-15, user's request: "the tax agency sheet should behave like a split"): a
 * tax line is a part of its row taken out by percentage, so each name taxed by an agency has
 * the sub-name "<name> - <agency>" — every tax line of that name and agency is under it
 * (the ledger finds it by name + agency; no row points at it). Made for every name's picked
 * active agency; one no longer picked (or of a renamed / removed agency) goes once no row
 * points at it. "Unclarified name" gets none. Returns how many were made.
 */
export async function syncTaxSubNames(
  prisma: PrismaService,
  scope: BookScope,
): Promise<number> {
  const [picks, agencies, names, subs] = await Promise.all([
    prisma.ledgerNameAgency.findMany({
      where: {
        ...scopeWhere(scope),
        agency: { deletedAt: null, active: true },
      },
      select: { name: true, agency: { select: { name: true } } },
    }),
    prisma.taxAgency.findMany({
      where: scopeWhere(scope),
      select: { name: true },
    }),
    prisma.ledgerName.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true },
    }),
    prisma.subName.findMany({
      where: { bookId: scope.bookId },
      select: { id: true, nameId: true, category: true },
    }),
  ]);
  const unclarified = UNCLARIFIED_NAME.toLowerCase();
  const nameOf = new Map(names.map((n) => [n.id, n.name.toLowerCase()]));
  const key = (name: string, category: string) =>
    `${name.trim().toLowerCase()}|${category}`;
  const want = new Map<string, { name: string; agency: string }>();
  for (const p of picks) {
    if (!p.name.trim() || p.name.trim().toLowerCase() === unclarified) continue;
    want.set(key(p.name, p.agency.name), { name: p.name, agency: p.agency.name });
  }
  const have = new Set(
    subs.flatMap((s) => {
      const n = nameOf.get(s.nameId);
      return n ? [key(n, s.category)] : [];
    }),
  );
  let made = 0;
  for (const [k, w] of want) {
    if (have.has(k)) continue;
    await ensureSubName(prisma, scope, w.name, w.agency);
    made++;
  }
  // Stale tax sub-names: in an agency's name (any agency of the book, removed ones too),
  // not wanted, and no row pointing at them.
  const agencyNames = new Set(agencies.map((a) => a.name));
  const stale = subs.filter((s) => {
    const n = nameOf.get(s.nameId);
    return (
      agencyNames.has(s.category) && !(n && want.has(key(n, s.category)))
    );
  });
  if (stale.length) {
    const used = await prisma.bankTransaction.groupBy({
      by: ['subNameId'],
      where: { subNameId: { in: stale.map((s) => s.id) } },
    });
    const usedIds = new Set(used.map((u) => u.subNameId));
    const drop = stale.filter((s) => !usedIds.has(s.id)).map((s) => s.id);
    if (drop.length) await prisma.subName.deleteMany({ where: { id: { in: drop } } });
  }
  return made;
}
