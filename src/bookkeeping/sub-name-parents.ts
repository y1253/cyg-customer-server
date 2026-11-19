import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { nameKeyOf } from './attachment-name.util';
import { fillNameAnswers } from './custom-column-defaults';
import { cleanName } from './name-memory.util';
import { scopeWhere, type BookScope } from './scope';
import { parentSubName, subNameFiling, subNameOf } from './sub-names.util';

/**
 * The sub-name of `parent` in `category`, made (with the parent's `LedgerName`) if new.
 * Plain IO on Prisma so `NameMemoryService` (which `SubNamesService` depends on) can use it.
 *
 * step9 (2026-11-17, second request): a name with sub-names is only a wrapper — its sub-names
 * are the names, with every setting. A new sub-name has its OWN split rules: the parent's
 * picks are copied to it (`appliedAt` kept, so nothing is cut again). `copyPicks` false =
 * a split rule's own sub-name ("Walmart - GST"), which takes none.
 */
export async function ensureSubName(
  prisma: PrismaService,
  scope: BookScope,
  parent: string,
  category: string,
  copyPicks = true,
): Promise<{ id: number; name: string }> {
  const nameId = await ledgerNameId(prisma, scope, parent);
  const found = await prisma.subName.findFirst({
    where: { bookId: scope.bookId, nameId, category },
    select: { id: true, name: true },
  });
  if (found) return found;
  const made = await prisma.subName.create({
    data: {
      ...scopeWhere(scope),
      nameId,
      name: subNameOf(parent, category),
      category,
      ownAgencies: true,
    },
    select: { id: true, name: true },
  });
  if (copyPicks) await copyParentPicks(prisma, scope, parent, made.name);
  return made;
}

/** The parent name's split rule picks, copied to its sub-name `sub` (keyed by its name). */
export async function copyParentPicks(
  prisma: PrismaService,
  scope: BookScope,
  parent: string,
  sub: string,
): Promise<void> {
  // MySQL compares names case-insensitively.
  const [picks, theirs] = await Promise.all([
    prisma.ledgerNameAgency.findMany({
      where: { ...scopeWhere(scope), name: cleanName(parent) ?? parent },
      select: { agencyId: true, lineName: true, appliedAt: true, alone: true },
    }),
    prisma.ledgerNameAgency.findMany({
      where: { ...scopeWhere(scope), name: sub },
      select: { agencyId: true },
    }),
  ]);
  const has = new Set(theirs.map((t) => t.agencyId));
  const data = picks
    .filter((p) => !has.has(p.agencyId))
    .map((p) => ({ ...scopeWhere(scope), name: sub, ...p }));
  if (data.length) await prisma.ledgerNameAgency.createMany({ data });
}

/**
 * step9 (2026-11-17, second request): the book's wrapper names — names with at least one
 * sub-name — lower-cased name to its `LedgerName` id.
 */
export async function wrapperNames(
  prisma: PrismaService,
  scope: BookScope,
): Promise<Map<string, number>> {
  const subs = await prisma.subName.findMany({
    where: { bookId: scope.bookId },
    select: { nameId: true },
    distinct: ['nameId'],
  });
  if (!subs.length) return new Map();
  const names = await prisma.ledgerName.findMany({
    where: { id: { in: subs.map((s) => s.nameId) } },
    select: { id: true, name: true },
  });
  return new Map(names.map((n) => [nameKeyOf(n.name), n.id]));
}

/**
 * step9 (2026-11-17, second request): a wrapper name has no settings of its own — the
 * change goes to one of its sub-names. Throws a plain message for the customer (and the AI).
 */
export async function refuseWrapper(
  prisma: PrismaService,
  scope: BookScope,
  name: string | null | undefined,
): Promise<void> {
  const clean = cleanName(name);
  if (!clean) return;
  const found = await prisma.ledgerName.findFirst({
    where: { ...scopeWhere(scope), name: clean },
    select: { id: true },
  });
  if (!found) return;
  const subs = await prisma.subName.count({
    where: { bookId: scope.bookId, nameId: found.id },
  });
  if (subs)
    throw new BadRequestException(
      `“${clean}” is a group of its sub-names — change one of its sub-names instead`,
    );
}

/**
 * step9 (2026-11-17, second request): every row of a wrapper name sits under the sub-name of
 * its own category (`subNameFiling`) — made if new. Rule splits keep theirs. Run after
 * `syncParentSubNames` (which calls it), statement reads and bank feeds. A sub-name left with
 * no row is removed. Returns how many rows moved.
 */
export async function fileUnderSubNames(
  prisma: PrismaService,
  scope: BookScope,
): Promise<number> {
  const wrappers = await wrapperNames(prisma, scope);
  if (!wrappers.size) return 0;
  const names = await prisma.ledgerName.findMany({
    where: { id: { in: [...wrappers.values()] } },
    select: { name: true },
  });
  // MySQL compares names case-insensitively.
  const rows = await prisma.bankTransaction.findMany({
    where: {
      ...scopeWhere(scope),
      splitRuleId: null,
      name: { in: names.map((n) => n.name) },
    },
    select: { id: true, name: true, offsetAccount: true, subNameId: true },
  });
  const subIds = [
    ...new Set(rows.flatMap((r) => (r.subNameId ? [r.subNameId] : []))),
  ];
  const subs = subIds.length
    ? await prisma.subName.findMany({
        where: { id: { in: subIds } },
        select: { id: true, nameId: true, category: true },
      })
    : [];
  const plan = subNameFiling(
    rows.map((r) => ({ ...r, category: r.offsetAccount })),
    wrappers,
    new Map(subs.map((s) => [s.id, s])),
  );
  if (!plan.length) return 0;
  const groups = new Map<
    string,
    { name: string; category: string; ids: number[] }
  >();
  for (const p of plan) {
    const k = `${nameKeyOf(p.name)}\u0000${p.category}`;
    const g = groups.get(k) ?? { name: p.name, category: p.category, ids: [] };
    g.ids.push(p.id);
    groups.set(k, g);
  }
  const before = new Map(rows.map((r) => [r.id, r.subNameId]));
  for (const g of groups.values()) {
    const sub = await ensureSubName(prisma, scope, g.name, g.category);
    await prisma.bankTransaction.updateMany({
      where: { id: { in: g.ids } },
      data: { subNameId: sub.id },
    });
  }
  const left = new Set(
    plan.flatMap((p) => {
      const was = before.get(p.id);
      return was ? [was] : [];
    }),
  );
  for (const id of left) await dropUnusedSubName(prisma, scope, id);
  return plan.length;
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
    // step9 (2026-11-17): a description rule that gave it keeps its name only.
    prisma.customerNameRule.updateMany({
      where: { bookId: sub.bookId, subNameId: id },
      data: { subNameId: null, category: null },
    }),
    // step9 (2026-11-19): its default custom-column answers go with it.
    prisma.customColumnNameAnswer.deleteMany({ where: { subNameId: id } }),
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
        // step9 (2026-11-17, second request): any split the customer made names it too.
        { splits: { some: { splitRuleId: null } } },
        { splits: { some: { subNameId: { not: null } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      offsetAccount: true,
      subNameId: true,
      personalRuleId: true,
      splits: {
        where: { OR: [{ splitRuleId: null }, { subNameId: { not: null } }] },
        select: { id: true },
      },
    },
  });
  if (!parents.length) {
    await fileUnderSubNames(prisma, scope);
    return 0;
  }
  const wrappers = await wrapperNames(prisma, scope);
  // step9 (2026-11-17): the description rules that give their rows a sub-name.
  const ruleIds = [
    ...new Set(
      parents.flatMap((p) => (p.personalRuleId ? [p.personalRuleId] : [])),
    ),
  ];
  const subRules = ruleIds.length
    ? await prisma.customerNameRule.findMany({
        where: { id: { in: ruleIds }, subNameId: { not: null } },
        select: { id: true, subNameId: true },
      })
    : [];
  const ruleSub = new Map(subRules.map((r) => [r.id, r.subNameId]));
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
      hasSplits: p.splits.length > 0,
      nameHasSubs: !!p.name && wrappers.has(nameKeyOf(p.name)),
      current: sub && parent ? { parent, category: sub.category } : null,
      fromRule:
        p.subNameId !== null &&
        p.personalRuleId !== null &&
        ruleSub.get(p.personalRuleId) === p.subNameId,
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
  // step9 (2026-11-17, second request): then every row of a wrapper name finds its sub-name.
  const filed = await fileUnderSubNames(prisma, scope);
  // step9 (2026-11-19): rows that changed name / sub-name take its default answers (empty
  // cells only).
  await fillNameAnswers(prisma, scope);
  return changed + filed;
}
