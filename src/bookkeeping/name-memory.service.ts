import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OWNERS_LOAN,
  UNCATEGORIZED,
  normalizeAccount,
} from './chart-of-accounts';
import { doubleEntry, type ExtractedTransaction } from './ledger.util';
import { bookLabel, scopeWhere, type BookScope } from './scope';
import {
  dropUnusedSubName,
  fileUnderSubNames,
  refuseWrapper,
  syncParentSubNames,
} from './sub-name-parents';
import { TaxService } from './tax.service';
import { UNCLARIFIED_NAME } from './reports.util';
import {
  bankPayeeName,
  byContainsPriority,
  cleanName,
  CONTAINS_MIN,
  containsKey,
  descriptionContains,
  isBankCharge,
  isOwnersLoanMove,
  descriptionKey,
  descriptionName,
  EXCEPTION,
  exceptionKey,
  fallbackName,
  findLinkConflicts,
  rowNameConflicts,
  indexRules,
  linkConflictMessage,
  memoryWrites,
  nameKey,
  nameMemoryWrites,
  resolveRow,
  resolveRows,
  RULE_CONFLICT,
  type MemoryEntry,
  type Resolved,
  type NameRule,
  type ResolveContext,
  type RuleMatchType,
} from './name-memory.util';

/**
 * How far an edit reaches:
 * - `ALWAYS` — saved as the customer's rule (`CustomerNameRule`): their existing rows AND
 *   every statement they read from now on.
 * - `ONCE` — nothing is saved for the future. The rows it touches are flagged
 *   `manualEdit`, so a later "Always" rule never overwrites them.
 */
export type EditScope = 'ALWAYS' | 'ONCE';

/**
 * The two memories of what a transaction is called and how it is categorised:
 *
 * - `DescriptionMemory` — FIRM-WIDE, what the AI concluded for a description the first time
 *   it saw it. Reused for every customer, and it outlives the statement it came from.
 * - `CustomerNameRule` — one customer's OWN edits from the Names tab or the ledger, which win
 *   over both the memory and the AI for that customer only.
 *
 * The rules themselves are pure (`name-memory.util.ts`); this is only the IO around them.
 */
@Injectable()
export class NameMemoryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NameMemoryService.name);

  /**
   * step9 backfill, with no script (the host has no ts-node): a minute after start, every
   * book with named rows that do not know where their name came from yet (`ruleName`
   * null) gets `syncProvenance` — once; afterwards every edit keeps it up to date.
   */
  onApplicationBootstrap(): void {
    setTimeout(
      () => void this.backfillNames().then(() => this.backfillProvenance()),
      60_000,
    ).unref();
  }

  /**
   * step11 backfill (same no-script pattern): rows with a real category and no name — read
   * before the rule "only Uncategorized may be nameless" — are named by their description,
   * then their book's provenance is synced. The `where` is its own "still to do" marker.
   */
  async backfillNames(): Promise<number> {
    try {
      const where = {
        name: null,
        offsetAccount: { not: UNCATEGORIZED },
      } satisfies Prisma.BankTransactionWhereInput;
      const books = await this.prisma.bankTransaction.groupBy({
        by: ['customerId', 'bookId', 'companyId'],
        where,
      });
      let named = 0;
      for (const b of books) {
        const descriptions = await this.prisma.bankTransaction.groupBy({
          by: ['description'],
          where: { ...where, ...scopeWhere(b) },
        });
        for (const { description } of descriptions) {
          const name = descriptionName(description);
          if (!name) continue;
          const done = await this.prisma.bankTransaction.updateMany({
            where: { ...where, ...scopeWhere(b), description },
            data: { name },
          });
          named += done.count;
        }
        await this.syncProvenance(b);
      }
      if (named)
        this.logger.log(
          `named ${named} categorized row(s) by their description in ${books.length} book(s)`,
        );
      return named;
    } catch (err) {
      this.logger.warn(`name backfill failed: ${String(err)}`);
      return 0;
    }
  }

  async backfillProvenance(): Promise<number> {
    try {
      const books = await this.prisma.bankTransaction.groupBy({
        by: ['customerId', 'bookId', 'companyId'],
        where: { ruleName: null, name: { not: null }, splitOfId: null },
      });
      for (const b of books) await this.syncProvenance(b);
      if (books.length)
        this.logger.log(`provenance backfilled for ${books.length} book(s)`);
      return books.length;
    } catch (err) {
      this.logger.warn(`provenance backfill failed: ${String(err)}`);
      return 0;
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
  ) {}

  /**
   * Everything `resolveRow` needs for these rows: four queries, whatever the count. `names`
   * are the names the rows carry (the AI's); the firm name memory is loaded for those, the
   * description memory's names and the customer's rule names.
   */
  async contextFor(
    scope: BookScope,
    descriptions: readonly string[],
    names: ReadonlyArray<string | null | undefined> = [],
  ): Promise<ResolveContext & { customAccounts: Set<string> }> {
    const keys = [...new Set(descriptions.map(descriptionKey).filter(Boolean))];
    const [memoryRows, rules, customAccounts, renamed] = await Promise.all([
      keys.length
        ? this.prisma.descriptionMemory.findMany({
            where: { descriptionKey: { in: keys } },
            select: {
              id: true,
              descriptionKey: true,
              name: true,
              category: true,
            },
          })
        : Promise.resolve([]),
      this.rulesOf(scope),
      this.customAccountsOf(scope),
      this.renamedAccountsOf(scope),
    ]);
    const memory = new Map<string, MemoryEntry>(
      memoryRows.map((m) => [
        m.descriptionKey,
        { id: m.id, name: m.name, category: m.category },
      ]),
    );
    const nameKeys = new Set<string>();
    for (const n of [
      ...names,
      ...memoryRows.map((m) => m.name),
      ...rules.map((r) => r.name),
    ]) {
      const clean = cleanName(n);
      if (clean) nameKeys.add(nameKey(clean));
    }
    const nameMemory = await this.nameMemoryFor([...nameKeys]);
    return {
      memory,
      ...indexRules(rules),
      customAccounts,
      nameMemory,
      renamed,
    };
  }

  /** The firm `NameMemory` for these name keys: `nameKey` → category. */
  private async nameMemoryFor(keys: string[]): Promise<Map<string, string>> {
    if (!keys.length) return new Map();
    const rows = await this.prisma.nameMemory.findMany({
      where: { nameKey: { in: keys } },
      select: { nameKey: true, category: true },
    });
    return new Map(rows.map((r) => [r.nameKey, r.category]));
  }

  async rulesOf(scope: BookScope): Promise<NameRule[]> {
    const rows = await this.prisma.customerNameRule.findMany({
      where: scopeWhere(scope),
      select: {
        id: true,
        matchType: true,
        matchKey: true,
        name: true,
        category: true,
        includeChars: true,
        subNameId: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      matchType:
        r.matchType === 'DESCRIPTION' ||
        r.matchType === 'CONTAINS' ||
        r.matchType === EXCEPTION
          ? r.matchType
          : 'NAME',
    }));
  }

  /** step2: the chart accounts this book renamed (`ResolveContext.renamed`). */
  private async renamedAccountsOf(
    scope: BookScope,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.customerAccount.findMany({
      where: { ...scopeWhere(scope), replaces: { not: null } },
      select: { name: true, replaces: true },
    });
    return new Map(
      rows.flatMap((r) =>
        r.replaces ? [[r.replaces.toLowerCase(), r.name] as const] : [],
      ),
    );
  }

  private async customAccountsOf(scope: BookScope): Promise<Set<string>> {
    const rows = await this.prisma.customerAccount.findMany({
      where: scopeWhere(scope),
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name));
  }

  /**
   * A freshly read statement: resolve every row against the customer's rules and the firm
   * memory, and teach the memory the AI's new answers. Returns the rows to write and the
   * customer's own categories (which `buildLedgerRows` must keep).
   *
   * Never throws — a memory outage must not fail a statement the AI has already paid to
   * read; the rows then keep the AI's own answers.
   */
  async resolveStatement(
    scope: BookScope,
    rows: ExtractedTransaction[],
    bankName: string | null = null,
    /** step9: the statement being (re-)read — its rows' one-time edits come back. */
    statementId?: number,
  ): Promise<{ lines: ExtractedTransaction[]; customAccounts: Set<string> }> {
    try {
      const ctx = {
        ...(await this.contextFor(
          scope,
          rows.map((r) => r.description),
          rows.map((r) => r.name),
        )),
        bankName,
      };
      // One category per name: a name new to the memory takes its first category here.
      const keyed = rows.map((r) => ({
        ...r,
        exceptionKey:
          statementId === undefined
            ? undefined
            : exceptionKey({
                statementId,
                postingDate: r.postingDate,
                pendingDate: r.pendingDate,
                amount: r.amount,
                description: r.description,
              }),
      }));
      const { resolved } = resolveRows(keyed, ctx);
      const lines = rows.map((r, i) => ({
        ...r,
        name: resolved[i].name,
        offsetAccount: resolved[i].category,
        provenance: {
          generalRuleId: resolved[i].generalRuleId,
          personalRuleId: resolved[i].personalRuleId,
          exceptionRuleId: resolved[i].exceptionRuleId,
          ruleName: resolved[i].ruleName,
          subNameId: resolved[i].subNameId,
        },
      }));
      await this.learn(rows, ctx.memory);
      await this.learnNames(resolved, ctx.nameMemory ?? new Map());
      return { lines, customAccounts: ctx.customAccounts };
    } catch (err) {
      this.logger.warn(
        `name memory unavailable for ${bookLabel(scope)}, keeping the AI's answers: ${String(err)}`,
      );
      const bank = bankPayeeName(bankName);
      const lines = rows.map((r) => {
        let out = r;
        if (bank && !cleanName(r.name) && isBankCharge(r.offsetAccount)) {
          out = { ...out, name: bank };
        }
        if (isOwnersLoanMove(r.description, r.offsetAccount)) {
          out = { ...out, offsetAccount: OWNERS_LOAN };
        }
        const name = fallbackName(out.name, out.offsetAccount, out.description);
        return name === out.name ? out : { ...out, name };
      });
      return { lines, customAccounts: new Set() };
    }
  }

  // ---- step9: the public edits — each one also brings the rows' provenance up to date ----

  /** See `applyRule`. */
  async saveRule(
    scope: BookScope,
    input: Parameters<NameMemoryService['applyRule']>[1],
  ): Promise<void> {
    // step9 (2026-11-17, second request): a name with sub-names has no settings of its own —
    // its category and its description rules go to one of its sub-names. Renaming it is fine.
    if (input.matchType === 'NAME') {
      if (input.category)
        await refuseWrapper(this.prisma, scope, input.name ?? input.matchKey);
    } else if (
      input.subNameId == null &&
      (input.matchType === 'CONTAINS' || (input.scope ?? 'ALWAYS') === 'ALWAYS')
    ) {
      await refuseWrapper(this.prisma, scope, input.name);
    }
    await this.applyRule(scope, input);
    await this.syncProvenance(scope);
  }

  /** See `applyEdit`. A ONE-TIME edit becomes an EXCEPTION rule (`syncProvenance`). */
  async editTransaction(
    scope: BookScope,
    id: number,
    input: Parameters<NameMemoryService['applyEdit']>[2],
  ): Promise<void> {
    await this.applyEdit(scope, id, input);
    await this.syncProvenance(scope);
  }

  /** step2 (2026-11-15): a name's ONE category (`setNameCategory`) — every row of it moves. */
  async setCategoryOfName(
    scope: BookScope,
    name: string,
    category: string,
  ): Promise<void> {
    const clean = cleanName(name);
    if (!clean) return;
    await refuseWrapper(this.prisma, scope, clean);
    await this.setNameCategory(
      scope,
      clean,
      normalizeAccount(category, await this.customAccountsOf(scope)),
    );
    await this.syncProvenance(scope);
  }

  /** See `applyMerge`. */
  async mergeNames(
    scope: BookScope,
    from: string,
    into: string,
  ): Promise<void> {
    // step9 (2026-11-17, second request): nothing is merged into or out of a wrapper name.
    await refuseWrapper(this.prisma, scope, from);
    await refuseWrapper(this.prisma, scope, into);
    await this.applyMerge(scope, from, into);
    await this.syncProvenance(scope);
  }

  /** See `applyReset`. */
  async resetRule(
    scope: BookScope,
    input: Parameters<NameMemoryService['applyReset']>[1],
  ): Promise<void> {
    await this.applyReset(scope, input);
    await this.syncProvenance(scope);
  }

  /**
   * step9 (2026-11-17, user's request): a split the customer makes by hand that gives its
   * transaction a sub-name saves the transaction's DESCRIPTION as a rule pointing at the
   * MAIN line's sub-name ("<name> - <its category>" — never a split rule's): every row with
   * that description, now (user's decision: existing rows too) and later, gets the sub-name
   * and its category, split or not. Run by `SplitsService` after `syncParentSubNames`, for
   * the transactions it touched. When no transaction of the description has such a split
   * any more, the rule keeps its name and loses the sub-name, and its rows go back to the
   * name's category. Never throws: a rule must not fail the split edit.
   */
  async syncSubNameRules(scope: BookScope, parentIds: number[]): Promise<void> {
    try {
      const parents = await this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), id: { in: parentIds }, splitOfId: null },
        select: { description: true },
      });
      const keys = [
        ...new Set(parents.map((p) => descriptionKey(p.description))),
      ].filter(Boolean);
      for (const key of keys) await this.syncSubNameRule(scope, key, parentIds);
    } catch (err) {
      this.logger.warn(
        `sub-name rules of ${bookLabel(scope)} not updated: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async syncSubNameRule(
    scope: BookScope,
    key: string,
    preferIds: readonly number[],
  ): Promise<void> {
    const rule = await this.prisma.customerNameRule.findFirst({
      where: { ...scopeWhere(scope), matchType: 'DESCRIPTION', matchKey: key },
    });
    // The transactions of this description whose hand-made split has a sub-name, the one
    // just edited first, then the newest.
    const candidates = (
      await this.prisma.bankTransaction.findMany({
        where: {
          ...scopeWhere(scope),
          splitOfId: null,
          manualEdit: false,
          subNameId: { not: null },
          name: { not: null },
          // step9 (2026-11-17, second request): any split the customer made.
          splits: { some: { splitRuleId: null } },
        },
        select: { id: true, description: true, name: true, subNameId: true },
        orderBy: { id: 'desc' },
      })
    )
      .filter((p) => descriptionKey(p.description) === key)
      // A description another name's rule holds is not taken over.
      .filter(
        (p) =>
          !cleanName(rule?.name) ||
          nameKey(rule!.name!) === nameKey(p.name ?? ''),
      )
      .sort(
        (a, b) =>
          Number(preferIds.includes(b.id)) - Number(preferIds.includes(a.id)),
      );
    const source = candidates[0];
    const oldSubId = rule?.subNameId ?? null;
    if (!source) {
      if (!rule || oldSubId === null) return;
      await this.prisma.customerNameRule.update({
        where: { id: rule.id },
        data: { subNameId: null, category: null },
      });
      // Its rows go back to their name's category.
      const rows = await this.prisma.bankTransaction.findMany({
        where: {
          ...scopeWhere(scope),
          splitOfId: null,
          subNameId: oldSubId,
          splits: { none: {} },
        },
        select: MATCH_SELECT,
      });
      const back = new Map<string, string | null>();
      for (const r of rows) {
        const k = nameKey(r.name ?? '');
        if (!back.has(k))
          back.set(k, r.name ? await this.categoryOfName(scope, r.name) : null);
      }
      await this.writeRows(scope, rows.map(toMatched), (r) => ({
        name: r.name,
        category: back.get(nameKey(r.name ?? '')) ?? r.offsetAccount,
        subNameId: null,
      }));
      // A wrapper name's rows go straight back under the sub-name of their category.
      await fileUnderSubNames(this.prisma, scope);
      await dropUnusedSubName(this.prisma, scope, oldSubId);
      return;
    }
    const sub = await this.prisma.subName.findUnique({
      where: { id: source.subNameId! },
      select: { id: true, category: true },
    });
    if (!sub) return;
    const name = cleanName(source.name)!;
    let ruleId = rule?.id;
    if (rule) {
      if (
        rule.subNameId !== sub.id ||
        rule.category !== sub.category ||
        rule.name !== name
      )
        await this.prisma.customerNameRule.update({
          where: { id: rule.id },
          data: { name, category: sub.category, subNameId: sub.id },
        });
    } else {
      const made = await this.prisma.customerNameRule.create({
        data: {
          ...scopeWhere(scope),
          matchType: 'DESCRIPTION',
          matchKey: key,
          name,
          category: sub.category,
          subNameId: sub.id,
        },
        select: { id: true },
      });
      ruleId = made.id;
    }
    // Every unsplit row of the description (not a one-time edit) takes the sub-name.
    const rows = (
      await this.prisma.bankTransaction.findMany({
        where: {
          ...scopeWhere(scope),
          splitOfId: null,
          manualEdit: false,
          splits: { none: {} },
        },
        select: MATCH_SELECT,
      })
    ).filter((r) => descriptionKey(r.description) === key);
    await this.writeRows(scope, rows.map(toMatched), () => ({
      name,
      category: sub.category,
      subNameId: sub.id,
      personalRuleId: ruleId ?? null,
    }));
    if (oldSubId !== null && oldSubId !== sub.id)
      await dropUnusedSubName(this.prisma, scope, oldSubId);
  }

  /**
   * step9: record on every row of the book WHERE its name and category come from —
   * `generalRuleId` (firm memory), `personalRuleId` (the customer's rule), `ruleName`
   * (the name those give) — by replaying `resolveRow` on the row as stored. Names and
   * categories are never changed here.
   *
   * A row the customer edited ONE time (`manualEdit`) whose name or category differs from
   * what the rules give is an EXCEPTION: it gets (or keeps, updated to the row) an
   * EXCEPTION rule keyed by `exceptionKey`, which a re-read of its statement applies again.
   * A one-time edit that matches the rules again is no exception, and its rule goes.
   * Never throws: provenance is a label, an edit must not fail on it.
   */
  async syncProvenance(scope: BookScope): Promise<void> {
    try {
      const rows = await this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), splitOfId: null },
        select: {
          id: true,
          statementId: true,
          externalId: true,
          postingDate: true,
          pendingDate: true,
          amount: true,
          description: true,
          name: true,
          offsetAccount: true,
          manualEdit: true,
          generalRuleId: true,
          personalRuleId: true,
          exceptionRuleId: true,
          ruleName: true,
        },
      });
      if (!rows.length) return;
      const ctx = await this.contextFor(
        scope,
        rows.map((r) => r.description),
        rows.map((r) => r.name),
      );
      const exceptions = ctx.exceptions ?? new Map<string, NameRule>();
      const keep = new Set<number>();
      const writes = new Map<string, number[]>();
      for (const r of rows) {
        const key = exceptionKey(r);
        // What the rules give the row, without its one-time edit — replayed from the name
        // the rules gave it before that edit (`ruleName`), else the name it has.
        const ruled = resolveRow(
          {
            description: r.description,
            name: r.manualEdit ? (r.ruleName ?? r.name) : r.name,
            offsetAccount: r.offsetAccount,
          },
          { ...ctx, exceptions: undefined },
        );
        const differs =
          nameKey(ruled.name ?? '') !== nameKey(r.name ?? '') ||
          ruled.category !== r.offsetAccount;
        let exceptionRuleId: number | null = null;
        const existing = exceptions.get(key);
        if (r.manualEdit && differs) {
          exceptionRuleId = await this.saveException(scope, key, existing, r);
          keep.add(exceptionRuleId);
        }
        const next = {
          generalRuleId: ruled.generalRuleId,
          personalRuleId: ruled.personalRuleId,
          exceptionRuleId,
          ruleName: ruled.name,
        };
        if (
          next.generalRuleId === r.generalRuleId &&
          next.personalRuleId === r.personalRuleId &&
          next.exceptionRuleId === r.exceptionRuleId &&
          next.ruleName === r.ruleName
        )
          continue;
        const k = JSON.stringify(next);
        writes.set(k, [...(writes.get(k) ?? []), r.id]);
      }
      for (const [k, ids] of writes) {
        const data = JSON.parse(k) as Record<string, unknown>;
        for (let i = 0; i < ids.length; i += 1000) {
          await this.prisma.bankTransaction.updateMany({
            where: { id: { in: ids.slice(i, i + 1000) } },
            data,
          });
        }
      }
      // Exception rules whose row is no exception any more (or is gone) go. A rule of a
      // statement that is being re-read right now is kept while it has no rows yet.
      const live = new Set(rows.map((r) => exceptionKey(r)));
      const stale = [...exceptions.entries()]
        .filter(
          ([key, rule]) =>
            live.has(key) && rule.id !== undefined && !keep.has(rule.id),
        )
        .map(([, rule]) => rule.id!);
      if (stale.length) {
        await this.prisma.customerNameRule.deleteMany({
          where: {
            id: { in: stale },
            ...scopeWhere(scope),
            matchType: EXCEPTION,
          },
        });
      }
      // step9: a split transaction's own sub-name follows its name and category.
      await syncParentSubNames(this.prisma, scope);
    } catch (err) {
      this.logger.warn(
        `provenance of ${bookLabel(scope)} not updated: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The EXCEPTION rule of one row, holding the row's own name and category. */
  private async saveException(
    scope: BookScope,
    key: string,
    existing: NameRule | undefined,
    row: { name: string | null; offsetAccount: string },
  ): Promise<number> {
    if (existing?.id !== undefined) {
      if (
        existing.name !== row.name ||
        existing.category !== row.offsetAccount
      ) {
        await this.prisma.customerNameRule.update({
          where: { id: existing.id },
          data: { name: row.name, category: row.offsetAccount },
        });
      }
      return existing.id;
    }
    const created = await this.prisma.customerNameRule.create({
      data: {
        ...scopeWhere(scope),
        matchType: EXCEPTION,
        matchKey: key,
        name: row.name,
        category: row.offsetAccount,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * step9: this row follows the rules again (an "always" edit of it): it is no one-time edit
   * and no exception any more.
   */
  private async clearException(scope: BookScope, id: number): Promise<void> {
    const row = await this.prisma.bankTransaction.findFirst({
      where: { id, ...scopeWhere(scope) },
      select: {
        statementId: true,
        externalId: true,
        postingDate: true,
        pendingDate: true,
        amount: true,
        description: true,
      },
    });
    if (!row) return;
    await this.prisma.customerNameRule.deleteMany({
      where: {
        ...scopeWhere(scope),
        matchType: EXCEPTION,
        matchKey: exceptionKey(row),
      },
    });
    await this.prisma.bankTransaction.update({
      where: { id },
      data: { manualEdit: false, exceptionRuleId: null },
    });
  }

  /** Store the AI's answers the memory lacks; count the ones it reused. */
  private async learn(
    rows: ExtractedTransaction[],
    memory: ReadonlyMap<string, MemoryEntry>,
  ): Promise<void> {
    const { creates, fills } = memoryWrites(rows, memory);
    const reused = [
      ...new Set(rows.map((r) => descriptionKey(r.description))),
    ].filter((k) => k && memory.has(k));
    if (creates.length) {
      await this.prisma.descriptionMemory.createMany({
        data: creates,
        skipDuplicates: true,
      });
    }
    for (const f of fills) {
      await this.prisma.descriptionMemory.update({
        where: { descriptionKey: f.descriptionKey },
        data: { name: f.name, category: f.category },
      });
    }
    if (reused.length) {
      await this.prisma.descriptionMemory.updateMany({
        where: { descriptionKey: { in: reused } },
        data: { hits: { increment: 1 } },
      });
    }
  }

  /** Store each name's first category the memory lacks; count the ones it reused. */
  private async learnNames(
    resolved: readonly Resolved[],
    known: ReadonlyMap<string, string>,
  ): Promise<void> {
    const { creates, fills } = nameMemoryWrites(resolved, known);
    if (creates.length) {
      await this.prisma.nameMemory.createMany({
        data: creates,
        skipDuplicates: true,
      });
    }
    for (const f of fills) {
      await this.prisma.nameMemory.update({
        where: { nameKey: f.nameKey },
        data: { category: f.category },
      });
    }
    const reused = [
      ...new Set(
        resolved.flatMap((r) =>
          r.followsName && r.name ? [nameKey(r.name)] : [],
        ),
      ),
    ].filter((k) => known.has(k));
    if (reused.length) {
      await this.prisma.nameMemory.updateMany({
        where: { nameKey: { in: reused } },
        data: { hits: { increment: 1 } },
      });
    }
  }

  /**
   * A change from the Names tab.
   *
   * NAME (a payee) — always: a rename is saved as the customer's rule and applied to every
   * row of theirs with that name (one-time renames stay). A category is the NAME's one
   * category (`setNameCategory`): every row of the name moves, one-time edits included.
   *
   * DESCRIPTION (an unrecognised group): the NAME goes on the rows with this description —
   * `ALWAYS` saved as a rule (every later statement too), `ONCE` only the rows there now.
   * The category belongs to that name; with no name it is the description's own category,
   * always (user's rule 2026-10-14: a category is never one-time).
   *
   * Editing a payee that an earlier rule already renamed updates THAT rule (the caller
   * passes the `ruleKey` the Names tab was given), so edits never chain.
   */
  private async applyRule(
    scope: BookScope,
    input: {
      matchType: RuleMatchType;
      matchKey: string;
      name: string | null;
      category: string | null;
      scope?: EditScope;
      /** step2: take the description from the name it is linked to now (`guardLinks`). */
      replace?: boolean;
      /**
       * step9 (2026-11-17, second request): DESCRIPTION — the sub-name of `name` its rows go
       * under (a description dropped on a sub-name); its category comes with it.
       */
      subNameId?: number | null;
    },
  ): Promise<void> {
    const matchKey = ruleKeyOf(input.matchType, input.matchKey);
    const name = cleanName(input.name);
    const category = input.category
      ? normalizeAccount(input.category, await this.customAccountsOf(scope))
      : null;
    if (
      name &&
      input.matchType !== 'NAME' &&
      (input.matchType === 'CONTAINS' || (input.scope ?? 'ALWAYS') === 'ALWAYS')
    ) {
      await this.guardLinks(
        scope,
        input.matchType,
        matchKey,
        name,
        input.replace,
      );
    }
    const where = {
      ...scopeWhere(scope),
      matchType: input.matchType,
      matchKey,
    };
    const previous = await this.prisma.customerNameRule.findFirst({ where });

    if (input.matchType === 'CONTAINS') {
      await this.saveContainsRule(
        scope,
        previous,
        where,
        input.matchKey,
        name,
        category,
      );
      return;
    }

    if (input.matchType === 'NAME') {
      // Rows this covers: those still carrying the original name AND those an earlier
      // version of the rule already renamed.
      const names = new Set<string>([matchKey]);
      if (previous?.name) names.add(nameKey(previous.name));
      if (!name) {
        if (category) {
          await this.setNameCategory(
            scope,
            cleanName(previous?.name) ?? matchKey,
            category,
          );
        }
        return;
      }
      const target = await this.categoryOfName(scope, name);
      await this.upsertRule(previous, { ...where, name }, { name });
      const rows = await this.matchingRows(
        scope,
        'NAME',
        matchKey,
        names,
        false,
      );
      await this.writeRows(scope, rows, (row) => ({
        name,
        category: row.offsetAccount,
      }));
      // The tax agencies live on the payee NAME, so a rename carries them over.
      await this.tax.carryAgencies(scope, [...names], name);
      // step2: and its group / "Tax applies" switch.
      await this.tax.carryNameSettings(scope, [...names], name);
      const adopt = category ?? target;
      if (adopt) await this.setNameCategory(scope, name, adopt);
      return;
    }

    const editScope = input.scope ?? 'ALWAYS';
    if (name && input.subNameId != null) {
      const sub = await this.subNameOf(scope, input.subNameId, name);
      if (editScope === 'ALWAYS') {
        await this.upsertRule(
          previous,
          { ...where, name, category: sub.category, subNameId: sub.id },
          { name, category: sub.category, subNameId: sub.id },
        );
      }
      const rows = await this.matchingRows(
        scope,
        'DESCRIPTION',
        matchKey,
        new Set(),
        editScope === 'ONCE',
      );
      await this.writeRows(
        scope,
        rows,
        () => ({ name, category: sub.category, subNameId: sub.id }),
        editScope === 'ONCE',
      );
      return;
    }
    if (name) {
      const target = await this.categoryOfName(scope, name);
      if (editScope === 'ALWAYS') {
        // The name carries the category from here on, not the description.
        await this.upsertRule(
          previous,
          { ...where, name },
          { name, category: null, subNameId: null },
        );
      }
      const rows = await this.matchingRows(
        scope,
        'DESCRIPTION',
        matchKey,
        new Set(),
        // A one-time change is the customer acting on these rows directly — it reaches the
        // ones an earlier one-time change touched. A saved rule does not.
        editScope === 'ONCE',
      );
      await this.writeRows(
        scope,
        rows,
        (row) => ({ name, category: row.offsetAccount }),
        editScope === 'ONCE',
      );
      const adopt = category ?? target;
      if (adopt) await this.setNameCategory(scope, name, adopt);
      return;
    }
    if (!category) return;
    // No name: the description's own category, for its nameless rows — always.
    await this.upsertRule(
      previous,
      { ...where, category },
      { category, subNameId: null },
    );
    const rows = await this.matchingRows(
      scope,
      'DESCRIPTION',
      matchKey,
      new Set(),
      true,
    );
    await this.writeRows(
      scope,
      rows.filter((r) => !cleanName(r.name)),
      () => ({ name: null, category }),
    );
  }

  /**
   * A CONTAINS rule (step2): every description holding the text, except those an exact
   * DESCRIPTION rule covers (that one means only its description and wins). A NAME goes on
   * the rows and carries its one category from there (the DESCRIPTION path's rule); with no
   * name the CATEGORY itself goes on every such row — named ones too (the customer's
   * request: "every description that includes it is that category") — unless the row's
   * name has a category of the customer's own, which `resolveRow` lets win.
   * Rows flagged `manualEdit` and splits are left alone, like every ALWAYS rule.
   */
  private async saveContainsRule(
    scope: BookScope,
    previous: { id: number } | null,
    where: Prisma.CustomerNameRuleUncheckedCreateInput,
    raw: string,
    name: string | null,
    category: string | null,
  ): Promise<void> {
    const includeChars = raw.trim().slice(0, 191);
    if (includeChars.length < CONTAINS_MIN) {
      throw new BadRequestException(
        `Type at least ${CONTAINS_MIN} characters the description must contain.`,
      );
    }
    if (!name && !category) {
      throw new BadRequestException('Pick a name or a category for this rule.');
    }
    const rows = await this.containsRows(scope, where.matchKey);
    if (name) {
      const target = await this.categoryOfName(scope, name);
      await this.upsertRule(
        previous,
        { ...where, includeChars, name, category: null },
        { includeChars, name, category: null },
      );
      await this.writeRows(scope, rows, (row) => ({
        name,
        category: row.offsetAccount,
      }));
      const adopt = category ?? target;
      if (adopt) await this.setNameCategory(scope, name, adopt);
      return;
    }
    await this.upsertRule(
      previous,
      { ...where, includeChars, name: null, category },
      { includeChars, name: null, category },
    );
    const { nameCategories } = indexRules(await this.rulesOf(scope));
    await this.writeRows(scope, rows, (row) => {
      const own = row.name ? nameCategories.get(nameKey(row.name)) : undefined;
      return { name: row.name, category: own ?? category! };
    });
  }

  /**
   * step2 (2026-11-08): a DESCRIPTION / CONTAINS rule for `name` that would take a
   * description from ANOTHER name is refused with a 409 `RULE_CONFLICT` listing those
   * links (`findLinkConflicts`) — unless `replace`: then the rules that would still win
   * (a longer text, an exact description) are deleted first, so the new link takes them.
   */
  private async guardLinks(
    scope: BookScope,
    matchType: 'DESCRIPTION' | 'CONTAINS',
    key: string,
    name: string,
    replace?: boolean,
  ): Promise<void> {
    // An exact description rule beats every text rule: nothing has to go.
    if (replace && matchType === 'DESCRIPTION') return;
    // Too short a text is refused by `saveContainsRule` — never asked about.
    if (matchType === 'CONTAINS' && key.length < CONTAINS_MIN) return;
    const [rules, rows] = await Promise.all([
      this.rulesOf(scope),
      this.prisma.bankTransaction.findMany({
        where: {
          ...scopeWhere(scope),
          splitOfId: null,
          statement: { deletedAt: null },
        },
        select: { description: true, name: true, manualEdit: true },
      }),
    ]);
    const ruled = findLinkConflicts({
      matchType,
      key,
      name,
      rules,
      descriptions: [...new Set(rows.map((r) => r.description))],
    });
    // step8: names the rows carry now, however they got them (AI, memory) — not only rules.
    const taken = new Set(ruled.map((c) => nameKey(c.name)));
    const conflicts = [
      ...ruled,
      ...rowNameConflicts({
        matchType,
        key,
        name,
        rows,
        rules,
        ignore: [UNCLARIFIED_NAME],
      }).filter((c) => !taken.has(nameKey(c.name))),
    ];
    if (!conflicts.length) return;
    if (!replace) {
      throw new ConflictException({
        code: RULE_CONFLICT,
        message: linkConflictMessage(conflicts, name),
        conflicts: conflicts.map(({ matchType: type, text, name: from }) => ({
          matchType: type,
          text,
          name: from,
        })),
      });
    }
    const ids = conflicts.flatMap((c) =>
      c.remove && c.ruleId ? [c.ruleId] : [],
    );
    if (ids.length) {
      await this.prisma.customerNameRule.deleteMany({
        where: { ...scopeWhere(scope), id: { in: ids } },
      });
    }
  }

  /**
   * The rows a CONTAINS rule reaches: live, not split, not a one-time edit, holding the text,
   * not covered by one of the customer's exact DESCRIPTION rules, and not won by a LONGER
   * text rule (`resolveRow` gives those to that rule — step2 fix: saving "AMZN" used to
   * rewrite the rows "AMZN MKTP" owns).
   */
  private async containsRows(
    scope: BookScope,
    key: string,
  ): Promise<MatchedRow[]> {
    const rules = await this.prisma.customerNameRule.findMany({
      where: {
        ...scopeWhere(scope),
        matchType: { in: ['DESCRIPTION', 'CONTAINS'] },
      },
      select: { matchType: true, matchKey: true },
    });
    const exact = new Set(
      rules.filter((r) => r.matchType === 'DESCRIPTION').map((r) => r.matchKey),
    );
    const contains = [
      ...rules.filter((r) => r.matchType === 'CONTAINS' && r.matchKey !== key),
      { matchKey: key },
    ].sort(byContainsPriority);
    const rows = await this.matchingRows(
      scope,
      'DESCRIPTION',
      '',
      new Set(),
      false,
      true,
    );
    return rows.filter(
      (r) =>
        descriptionContains(r.description, key) &&
        !exact.has(descriptionKey(r.description)) &&
        contains.find((c) => descriptionContains(r.description, c.matchKey))
          ?.matchKey === key,
    );
  }

  /**
   * A change made on ONE ledger row (its Name or Category cell).
   *
   * The NAME: `ALWAYS` = every row with this description, now and on every later statement
   * (a DESCRIPTION rule); `ONCE` = only this row (flagged `manualEdit`). Its category then
   * follows the name's (or the one picked).
   * The CATEGORY: always the NAME's one category — every row of that name moves; a row with
   * no name sets its description's category instead.
   * A hand-made split belongs to its one transaction: only it changes.
   */
  private async applyEdit(
    scope: BookScope,
    id: number,
    input: {
      name: string | null;
      category: string | null;
      scope: EditScope;
      replace?: boolean;
    },
  ): Promise<void> {
    const row = await this.prisma.bankTransaction.findFirst({
      where: { id, ...scopeWhere(scope) },
      select: { ...MATCH_SELECT, manualEdit: true, splitOfId: true },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    const custom = await this.customAccountsOf(scope);
    const name = cleanName(input.name);
    const category = input.category
      ? normalizeAccount(input.category, custom)
      : null;
    const matched = toMatched(row);

    if (row.splitOfId) {
      // step2 (2026-11-15): "Always" on a split = its transaction's DESCRIPTION goes to the
      // name (asked first when another name has it), and EVERYTHING moves — the
      // transaction's own line too, an earlier one-time edit of it included (user's decision).
      if (name && name !== row.name && input.scope === 'ALWAYS') {
        const parent = await this.prisma.bankTransaction.findFirst({
          where: { id: row.splitOfId, ...scopeWhere(scope) },
          select: { ...MATCH_SELECT, manualEdit: true },
        });
        const key = parent ? descriptionKey(parent.description) : '';
        if (!parent || !key) {
          throw new BadRequestException(
            'This transaction has no description to remember. Apply the name to this split only.',
          );
        }
        await this.guardLinks(scope, 'DESCRIPTION', key, name, input.replace);
        if (parent.manualEdit) {
          await this.writeRows(scope, [toMatched(parent)], (r) => ({
            name,
            category: r.offsetAccount,
          }));
          await this.clearException(scope, parent.id);
        }
        await this.applyRule(scope, {
          matchType: 'DESCRIPTION',
          matchKey: key,
          name,
          category,
          scope: 'ALWAYS',
          replace: true,
        });
      }
      await this.writeRows(
        scope,
        [matched],
        (r) => ({
          name: name ?? r.name,
          category: category ?? r.offsetAccount,
        }),
        true,
      );
      return;
    }

    const key = descriptionKey(row.description);
    if (name && name !== row.name) {
      if (input.scope === 'ONCE') {
        const target = await this.categoryOfName(scope, name);
        await this.writeRows(
          scope,
          [matched],
          (r) => ({ name, category: r.offsetAccount }),
          true,
        );
        const adopt = category ?? target;
        if (adopt) await this.setNameCategory(scope, name, adopt);
        return;
      }
      if (!key) {
        throw new BadRequestException(
          'This transaction has no description to remember. Apply the name to this row only.',
        );
      }
      // Asked BEFORE the clicked row changes, so a refusal changes nothing.
      await this.guardLinks(scope, 'DESCRIPTION', key, name, input.replace);
      // The clicked row too, even when an earlier one-time edit flagged it — and it is no
      // exception any more (step9): the rule for every row is now its rule.
      if (row.manualEdit) {
        await this.writeRows(scope, [matched], (r) => ({
          name,
          category: r.offsetAccount,
        }));
        await this.clearException(scope, row.id);
      }
      await this.applyRule(scope, {
        matchType: 'DESCRIPTION',
        matchKey: key,
        name,
        category,
        scope: 'ALWAYS',
        replace: true,
      });
      return;
    }

    if (!category) return;
    const current = cleanName(row.name);
    if (current) {
      await this.setNameCategory(scope, current, category);
    } else if (key) {
      await this.applyRule(scope, {
        matchType: 'DESCRIPTION',
        matchKey: key,
        name: null,
        category,
      });
    } else {
      await this.writeRows(
        scope,
        [matched],
        (r) => ({ name: r.name, category }),
        true,
      );
    }
  }

  /**
   * A name's ONE category, chosen by the customer: saved on every rule of theirs that ends
   * in this name (or a new NAME rule for it), and EVERY row of the name moves — one-time
   * edits included, splits not (they are a receipt's items).
   */
  private async setNameCategory(
    scope: BookScope,
    name: string,
    category: string,
  ): Promise<void> {
    const key = nameKey(name);
    const rules = await this.prisma.customerNameRule.findMany({
      where: { ...scopeWhere(scope), matchType: 'NAME' },
      select: { id: true, matchKey: true, name: true },
    });
    const targeting = rules.filter(
      (r) => (cleanName(r.name) ? nameKey(r.name!) : r.matchKey) === key,
    );
    if (targeting.length) {
      await this.prisma.customerNameRule.updateMany({
        where: { id: { in: targeting.map((r) => r.id) } },
        data: { category },
      });
    } else if (!rules.some((r) => r.matchKey === key)) {
      await this.prisma.customerNameRule.create({
        data: {
          ...scopeWhere(scope),
          matchType: 'NAME',
          matchKey: key,
          category,
        },
      });
    }
    // MySQL compares names case-insensitively, which is what a name key means.
    // step9 (2026-11-17): a row filed under a sub-name by its description rule (a sub-name
    // and no splits) keeps that sub-name's category.
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        ...scopeWhere(scope),
        name: key,
        splitOfId: null,
        NOT: { subNameId: { not: null }, splits: { none: {} } },
      },
      select: MATCH_SELECT,
    });
    await this.writeRows(scope, rows.map(toMatched), (r) => ({
      name: r.name,
      category,
    }));
  }

  /**
   * The category a name already has for this customer: their own choice, else the firm
   * memory's, else what most of their rows of it are in. Null for a name new to everyone.
   */
  /** The category a name has for this customer: their rule, the firm memory, their rows. */
  async categoryOfName(scope: BookScope, name: string): Promise<string | null> {
    const key = nameKey(name);
    const own = indexRules(await this.rulesOf(scope)).nameCategories.get(key);
    if (own) return own;
    const remembered = await this.prisma.nameMemory.findUnique({
      where: { nameKey: key },
      select: { category: true },
    });
    if (remembered && remembered.category !== UNCATEGORIZED) {
      return remembered.category;
    }
    const groups = await this.prisma.bankTransaction.groupBy({
      by: ['offsetAccount'],
      where: { ...scopeWhere(scope), name: key, splitOfId: null },
      _count: { _all: true },
    });
    const usual = groups
      .filter((g) => g.offsetAccount !== UNCATEGORIZED)
      .sort((a, b) => b._count._all - a._count._all)[0];
    return usual?.offsetAccount ?? null;
  }

  /** The key to edit a payee under: its existing NAME rule's (rename target or key), else its own. */
  private async ruleKeyForName(
    scope: BookScope,
    name: string,
  ): Promise<string> {
    const key = nameKey(name);
    const rules = await this.prisma.customerNameRule.findMany({
      where: { ...scopeWhere(scope), matchType: 'NAME' },
      select: { matchKey: true, name: true },
    });
    const hit = rules.find(
      (r) => r.matchKey === key || (r.name && nameKey(r.name) === key),
    );
    return hit?.matchKey ?? key;
  }

  /**
   * step8: merge payee `from` into `into` (the Names tab: drag one name onto another).
   * Every row of `from` — one-time edits included — takes `into`'s name and category; its
   * tax is `into`'s alone (`from`'s agencies are dropped, not carried); the rules that gave
   * rows the name `from` now give `into`; and a NAME rule `from → into` makes later rows
   * follow. Tax agencies and "Unclarified name" are not payees, so they never merge.
   */
  private async applyMerge(
    scope: BookScope,
    from: string,
    into: string,
  ): Promise<void> {
    const source = cleanName(from);
    const target = cleanName(into);
    if (!source || !target) throw new BadRequestException('Pick two names.');
    if (nameKey(source) === nameKey(target))
      throw new BadRequestException('That is the same name.');
    if ([source, target].some((n) => nameKey(n) === nameKey(UNCLARIFIED_NAME)))
      throw new BadRequestException(
        '"Unclarified name" cannot be merged — give its rows a name instead.',
      );
    const agencies = await this.prisma.taxAgency.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      select: { name: true },
    });
    const agency = [source, target].find((n) =>
      agencies.some((a) => nameKey(a.name) === nameKey(n)),
    );
    if (agency)
      throw new BadRequestException(
        `"${agency}" is a tax agency — tax agencies cannot be merged.`,
      );
    const rows = await this.matchingRows(
      scope,
      'NAME',
      nameKey(source),
      new Set([nameKey(source)]),
      true,
    );
    if (!rows.length)
      throw new NotFoundException(`No rows are named "${source}".`);
    // The target's category, read BEFORE the rows move (they would vote for their own).
    const category =
      (await this.categoryOfName(scope, target)) ?? UNCATEGORIZED;

    // Rules that named rows `source` (renames to it, description / contains rules) → target.
    await this.prisma.customerNameRule.updateMany({
      where: { ...scopeWhere(scope), name: source },
      data: { name: target },
    });
    const where = {
      ...scopeWhere(scope),
      matchType: 'NAME' as const,
      matchKey: nameKey(source),
    };
    const previous = await this.prisma.customerNameRule.findFirst({ where });
    await this.upsertRule(
      previous,
      { ...where, name: target, category: null },
      { name: target, category: null },
    );
    await this.writeRows(scope, rows, () => ({ name: target, category }));
    if (category !== UNCATEGORIZED)
      await this.setNameCategory(scope, target, category);
    // step2 (2026-11-09): its profile fields (phone, email, …) join the target's.
    await this.tax.mergeNameFields(scope, source, target);
    // step2 (2026-11-11): its files and subfolders join the target's folder.
    await this.tax.moveNameFiles(scope, [source], target);
    // step2 (2026-11-15): its splits and sub-names too (before its LedgerName goes).
    await this.tax.moveSubNames(scope, [source], target);
    // The tax follows the target only: the merged name's own choices go.
    await this.prisma.ledgerNameAgency.deleteMany({
      where: { ...scopeWhere(scope), name: source },
    });
    await this.prisma.ledgerName.deleteMany({
      where: { ...scopeWhere(scope), name: source },
    });
    this.logger.log(
      `book ${bookLabel(scope)}: merged name "${source}" into "${target}" (${rows.length} rows)`,
    );
  }

  /**
   * Remove a customer's rule: their rows go back to what the firm memory says for each
   * description (and keep what they have where the memory knows nothing). One-time edits
   * stay as they are.
   */
  private async applyReset(
    scope: BookScope,
    input: { matchType: RuleMatchType; matchKey: string },
  ): Promise<void> {
    const matchKey = ruleKeyOf(input.matchType, input.matchKey);
    const rule = await this.prisma.customerNameRule.findFirst({
      where: { ...scopeWhere(scope), matchType: input.matchType, matchKey },
    });
    if (!rule) throw new NotFoundException('That name has no saved change');
    if (input.matchType === 'CONTAINS') {
      // The rows it reaches now, read before it goes.
      const reached = await this.containsRows(scope, matchKey);
      await this.prisma.customerNameRule.delete({ where: { id: rule.id } });
      await this.reresolveAfterContains(scope, rule, reached);
      return;
    }
    await this.prisma.customerNameRule.delete({ where: { id: rule.id } });

    const names = new Set<string>([matchKey]);
    if (rule.name) names.add(nameKey(rule.name));
    const rows = await this.matchingRows(
      scope,
      input.matchType,
      matchKey,
      names,
      false,
    );
    if (!rows.length) return;
    // Re-resolve WITHOUT the deleted rule — any other rule of theirs still applies.
    const ctx = await this.contextFor(
      scope,
      rows.map((r) => r.description),
      rows.map((r) => r.name),
    );
    await this.writeRows(scope, rows, (row) => {
      const key = descriptionKey(row.description);
      const remembered = key ? ctx.memory.get(key) : undefined;
      // What the row was before the rule: the memory's answer, else — for a NAME rule —
      // the original name (the rule's key), and for a DESCRIPTION rule (an unrecognised
      // row) no name and Uncategorized, which is all the AI had found.
      const base =
        input.matchType === 'NAME'
          ? {
              description: row.description,
              name: remembered?.name ?? originalName(row.name, matchKey),
              offsetAccount: remembered?.category ?? row.offsetAccount,
            }
          : {
              description: row.description,
              name: remembered?.name ?? null,
              offsetAccount: remembered?.category ?? UNCATEGORIZED,
            };
      const out = resolveRow(base, ctx);
      return { name: out.name, category: out.category };
    });
  }

  /**
   * A CONTAINS rule was removed: its rows go back to the firm memory's answer for their
   * description, then through every rule the customer still has (another CONTAINS rule may
   * now take them). What the rule replaced is not known any more, so a renamed row loses
   * the name (the memory's, else none) and a re-categorised one its category (the
   * memory's, else Uncategorized, then its name's).
   */
  private async reresolveAfterContains(
    scope: BookScope,
    rule: { name: string | null; category: string | null },
    rows: MatchedRow[],
  ): Promise<void> {
    if (!rows.length) return;
    const ctx = await this.contextFor(
      scope,
      rows.map((r) => r.description),
      rows.map((r) => r.name),
    );
    const renamed = !!cleanName(rule.name);
    await this.writeRows(scope, rows, (row) => {
      const key = descriptionKey(row.description);
      const remembered = key ? ctx.memory.get(key) : undefined;
      const out = resolveRow(
        {
          description: row.description,
          name: remembered?.name ?? (renamed ? null : row.name),
          offsetAccount:
            remembered?.category ??
            (rule.category ? UNCATEGORIZED : row.offsetAccount),
        },
        ctx,
      );
      return { name: out.name, category: out.category };
    });
  }

  /**
   * Create or update one rule. Not a compound-key upsert: the key holds companyId, which is
   * NULL for the general book, and Prisma cannot address a NULL through a unique key.
   */
  /** step9 (2026-11-17, second request): a sub-name of `name` in the book, or a 400. */
  private async subNameOf(
    scope: BookScope,
    id: number,
    name: string,
  ): Promise<{ id: number; category: string }> {
    const sub = await this.prisma.subName.findFirst({
      where: { id, bookId: scope.bookId, customerId: scope.customerId },
      select: { id: true, nameId: true, category: true },
    });
    const parent = sub
      ? await this.prisma.ledgerName.findUnique({
          where: { id: sub.nameId },
          select: { name: true },
        })
      : null;
    if (!sub || !parent || nameKey(parent.name) !== nameKey(name))
      throw new BadRequestException(`That is not a sub-name of “${name}”.`);
    return sub;
  }

  private async upsertRule(
    existing: { id: number } | null,
    create: Prisma.CustomerNameRuleUncheckedCreateInput,
    update: Prisma.CustomerNameRuleUpdateInput,
  ): Promise<void> {
    if (existing) {
      await this.prisma.customerNameRule.update({
        where: { id: existing.id },
        data: update,
      });
    } else {
      try {
        await this.prisma.customerNameRule.create({ data: create });
      } catch (e) {
        // Two saves of the same key at once: the other one created it first.
        if ((e as { code?: string }).code !== 'P2002') throw e;
        throw new ConflictException({
          code: RULE_CONFLICT,
          message:
            'This was just changed by another save. Refresh the page and try again.',
          conflicts: [],
        });
      }
    }
  }

  private async matchingRows(
    scope: BookScope,
    matchType: RuleMatchType,
    matchKey: string,
    names: ReadonlySet<string>,
    includeManual: boolean,
    /** Every row of the book (the caller filters) — how a CONTAINS rule finds its rows. */
    all = false,
  ): Promise<MatchedRow[]> {
    // Splits are a receipt's items or the customer's own parts: never a rule's rows.
    const manual = includeManual
      ? { splitOfId: null }
      : { manualEdit: false, splitOfId: null };
    if (matchType === 'NAME') {
      // MySQL compares names case-insensitively, which is what a NAME key means.
      const rows = await this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), name: { in: [...names] }, ...manual },
        select: MATCH_SELECT,
      });
      return rows.map(toMatched);
    }
    const rows = await this.prisma.bankTransaction.findMany({
      where: { ...scopeWhere(scope), ...manual },
      select: MATCH_SELECT,
    });
    if (all) return rows.map(toMatched);
    return rows
      .filter((r) => descriptionKey(r.description) === matchKey)
      .map(toMatched);
  }

  /**
   * Apply `next` to these rows. Their taxes follow by themselves — they are decided by the
   * row's name and category on read (`TaxService.linesFor`), so the ledger, the chart of
   * accounts and the income statement are right as soon as the request returns.
   * `manual` flags the rows as a one-time edit (or, false, leaves the flag as it is).
   */
  private async writeRows(
    scope: BookScope,
    rows: MatchedRow[],
    next: (row: MatchedRow) => {
      name: string | null;
      category: string;
      /** step9 (2026-11-17): the row's sub-name too (undefined = leave it). */
      subNameId?: number | null;
      personalRuleId?: number | null;
    },
    manual = false,
  ): Promise<void> {
    const updates = rows.flatMap((row) => {
      const out = next(row);
      const category = out.category;
      // step11: only an Uncategorized row may be nameless.
      const name = fallbackName(out.name, category, row.description);
      const subChanged =
        out.subNameId !== undefined && out.subNameId !== row.subNameId;
      // step9 part 2: a row already under the sub-name still records the rule that files it.
      const ruleChanged =
        out.personalRuleId !== undefined &&
        row.personalRuleId !== undefined &&
        out.personalRuleId !== row.personalRuleId;
      if (
        name === row.name &&
        category === row.offsetAccount &&
        !subChanged &&
        !ruleChanged
      )
        return [];
      // The bank side never changes; only the offset does, so re-derive both columns.
      const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
      return [
        this.prisma.bankTransaction.update({
          where: { id: row.id },
          data: {
            name,
            offsetAccount: category,
            ...doubleEntry(row.amount, bank, category),
            ...(out.subNameId !== undefined && { subNameId: out.subNameId }),
            ...(out.personalRuleId !== undefined && {
              personalRuleId: out.personalRuleId,
            }),
            ...(manual && { manualEdit: true }),
          },
        }),
      ];
    });
    if (!updates.length) return;
    await this.prisma.$transaction(updates);
  }
}

const MATCH_SELECT = {
  id: true,
  description: true,
  name: true,
  amount: true,
  offsetAccount: true,
  debitAccount: true,
  creditAccount: true,
  subNameId: true,
  personalRuleId: true,
} as const;

const ruleKeyOf = (matchType: RuleMatchType, raw: string): string =>
  matchType === 'NAME'
    ? nameKey(raw)
    : matchType === 'CONTAINS'
      ? containsKey(raw)
      : descriptionKey(raw) || raw.trim().toLowerCase();

/**
 * The name a NAME rule's rows had before it renamed them. The key is lower-cased, so a row
 * still carrying the original spelling keeps it; a renamed row gets the key back, title-cased.
 */
function originalName(current: string | null, matchKey: string): string {
  if (current && nameKey(current) === matchKey) return current;
  return matchKey.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export interface MatchedRow {
  id: number;
  description: string;
  name: string | null;
  amount: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
  subNameId?: number | null;
  personalRuleId?: number | null;
}

function toMatched(r: {
  id: number;
  description: string;
  name: string | null;
  amount: { toString(): string };
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
  subNameId?: number | null;
  personalRuleId?: number | null;
}): MatchedRow {
  return {
    id: r.id,
    description: r.description,
    name: r.name,
    amount: Number(r.amount.toString()),
    offsetAccount: r.offsetAccount,
    debitAccount: r.debitAccount,
    creditAccount: r.creditAccount,
    subNameId: r.subNameId ?? null,
    personalRuleId: r.personalRuleId ?? null,
  };
}
