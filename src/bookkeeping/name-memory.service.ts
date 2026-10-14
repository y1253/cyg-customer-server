import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OWNERS_LOAN,
  UNCATEGORIZED,
  normalizeAccount,
} from './chart-of-accounts';
import { doubleEntry, type ExtractedTransaction } from './ledger.util';
import { TaxService } from './tax.service';
import {
  bankPayeeName,
  cleanName,
  isBankCharge,
  isOwnersLoanMove,
  descriptionKey,
  indexRules,
  memoryWrites,
  nameKey,
  nameMemoryWrites,
  resolveRow,
  resolveRows,
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
export class NameMemoryService {
  private readonly logger = new Logger(NameMemoryService.name);

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
    customerId: number,
    descriptions: readonly string[],
    names: ReadonlyArray<string | null | undefined> = [],
  ): Promise<ResolveContext & { customAccounts: Set<string> }> {
    const keys = [...new Set(descriptions.map(descriptionKey).filter(Boolean))];
    const [memoryRows, rules, customAccounts] = await Promise.all([
      keys.length
        ? this.prisma.descriptionMemory.findMany({
            where: { descriptionKey: { in: keys } },
            select: { descriptionKey: true, name: true, category: true },
          })
        : Promise.resolve([]),
      this.rulesOf(customerId),
      this.customAccountsOf(customerId),
    ]);
    const memory = new Map<string, MemoryEntry>(
      memoryRows.map((m) => [
        m.descriptionKey,
        { name: m.name, category: m.category },
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
    return { memory, ...indexRules(rules), customAccounts, nameMemory };
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

  async rulesOf(customerId: number): Promise<NameRule[]> {
    const rows = await this.prisma.customerNameRule.findMany({
      where: { customerId },
      select: { matchType: true, matchKey: true, name: true, category: true },
    });
    return rows.map((r) => ({
      ...r,
      matchType: r.matchType === 'DESCRIPTION' ? 'DESCRIPTION' : 'NAME',
    }));
  }

  private async customAccountsOf(customerId: number): Promise<Set<string>> {
    const rows = await this.prisma.customerAccount.findMany({
      where: { customerId },
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
    customerId: number,
    rows: ExtractedTransaction[],
    bankName: string | null = null,
  ): Promise<{ lines: ExtractedTransaction[]; customAccounts: Set<string> }> {
    try {
      const ctx = {
        ...(await this.contextFor(
          customerId,
          rows.map((r) => r.description),
          rows.map((r) => r.name),
        )),
        bankName,
      };
      // One category per name: a name new to the memory takes its first category here.
      const { resolved } = resolveRows(rows, ctx);
      const lines = rows.map((r, i) => ({
        ...r,
        name: resolved[i].name,
        offsetAccount: resolved[i].category,
      }));
      await this.learn(rows, ctx.memory);
      await this.learnNames(resolved, ctx.nameMemory ?? new Map());
      return { lines, customAccounts: ctx.customAccounts };
    } catch (err) {
      this.logger.warn(
        `name memory unavailable for customer ${customerId}, keeping the AI's answers: ${String(err)}`,
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
        return out;
      });
      return { lines, customAccounts: new Set() };
    }
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
  async saveRule(
    customerId: number,
    input: {
      matchType: RuleMatchType;
      matchKey: string;
      name: string | null;
      category: string | null;
      scope?: EditScope;
    },
  ): Promise<void> {
    const matchKey = ruleKeyOf(input.matchType, input.matchKey);
    const name = cleanName(input.name);
    const category = input.category
      ? normalizeAccount(
          input.category,
          await this.customAccountsOf(customerId),
        )
      : null;
    const where = {
      customerId_matchType_matchKey: {
        customerId,
        matchType: input.matchType,
        matchKey,
      },
    };
    const previous = await this.prisma.customerNameRule.findUnique({ where });

    if (input.matchType === 'NAME') {
      // Rows this covers: those still carrying the original name AND those an earlier
      // version of the rule already renamed.
      const names = new Set<string>([matchKey]);
      if (previous?.name) names.add(nameKey(previous.name));
      if (!name) {
        if (category) {
          await this.setNameCategory(
            customerId,
            cleanName(previous?.name) ?? matchKey,
            category,
          );
        }
        return;
      }
      const target = await this.categoryOfName(customerId, name);
      await this.prisma.customerNameRule.upsert({
        where,
        create: { customerId, matchType: 'NAME', matchKey, name },
        update: { name },
      });
      const rows = await this.matchingRows(
        customerId,
        'NAME',
        matchKey,
        names,
        false,
      );
      await this.writeRows(customerId, rows, (row) => ({
        name,
        category: row.offsetAccount,
      }));
      // "Tax applies" lives on the payee NAME, so a rename carries it over.
      await this.carryTaxSwitch(customerId, [...names], name);
      const adopt = category ?? target;
      if (adopt) await this.setNameCategory(customerId, name, adopt);
      return;
    }

    const scope = input.scope ?? 'ALWAYS';
    if (name) {
      const target = await this.categoryOfName(customerId, name);
      if (scope === 'ALWAYS') {
        // The name carries the category from here on, not the description.
        await this.prisma.customerNameRule.upsert({
          where,
          create: { customerId, matchType: 'DESCRIPTION', matchKey, name },
          update: { name, category: null },
        });
      }
      const rows = await this.matchingRows(
        customerId,
        'DESCRIPTION',
        matchKey,
        new Set(),
        // A one-time change is the customer acting on these rows directly — it reaches the
        // ones an earlier one-time change touched. A saved rule does not.
        scope === 'ONCE',
      );
      await this.writeRows(
        customerId,
        rows,
        (row) => ({ name, category: row.offsetAccount }),
        scope === 'ONCE',
      );
      const adopt = category ?? target;
      if (adopt) await this.setNameCategory(customerId, name, adopt);
      return;
    }
    if (!category) return;
    // No name: the description's own category, for its nameless rows — always.
    await this.prisma.customerNameRule.upsert({
      where,
      create: { customerId, matchType: 'DESCRIPTION', matchKey, category },
      update: { category },
    });
    const rows = await this.matchingRows(
      customerId,
      'DESCRIPTION',
      matchKey,
      new Set(),
      true,
    );
    await this.writeRows(
      customerId,
      rows.filter((r) => !cleanName(r.name)),
      () => ({ name: null, category }),
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
  async editTransaction(
    customerId: number,
    id: number,
    input: { name: string | null; category: string | null; scope: EditScope },
  ): Promise<void> {
    const row = await this.prisma.bankTransaction.findFirst({
      where: { id, customerId },
      select: { ...MATCH_SELECT, manualEdit: true, splitOfId: true },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    const custom = await this.customAccountsOf(customerId);
    const name = cleanName(input.name);
    const category = input.category
      ? normalizeAccount(input.category, custom)
      : null;
    const matched = toMatched(row);

    if (row.splitOfId) {
      await this.writeRows(
        customerId,
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
        const target = await this.categoryOfName(customerId, name);
        await this.writeRows(
          customerId,
          [matched],
          (r) => ({ name, category: r.offsetAccount }),
          true,
        );
        const adopt = category ?? target;
        if (adopt) await this.setNameCategory(customerId, name, adopt);
        return;
      }
      if (!key) {
        throw new BadRequestException(
          'This transaction has no description to remember. Apply the name to this row only.',
        );
      }
      // The clicked row too, even when an earlier one-time edit flagged it.
      if (row.manualEdit) {
        await this.writeRows(customerId, [matched], (r) => ({
          name,
          category: r.offsetAccount,
        }));
      }
      await this.saveRule(customerId, {
        matchType: 'DESCRIPTION',
        matchKey: key,
        name,
        category,
        scope: 'ALWAYS',
      });
      return;
    }

    if (!category) return;
    const current = cleanName(row.name);
    if (current) {
      await this.setNameCategory(customerId, current, category);
    } else if (key) {
      await this.saveRule(customerId, {
        matchType: 'DESCRIPTION',
        matchKey: key,
        name: null,
        category,
      });
    } else {
      await this.writeRows(
        customerId,
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
    customerId: number,
    name: string,
    category: string,
  ): Promise<void> {
    const key = nameKey(name);
    const rules = await this.prisma.customerNameRule.findMany({
      where: { customerId, matchType: 'NAME' },
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
        data: { customerId, matchType: 'NAME', matchKey: key, category },
      });
    }
    // MySQL compares names case-insensitively, which is what a name key means.
    const rows = await this.prisma.bankTransaction.findMany({
      where: { customerId, name: key, splitOfId: null },
      select: MATCH_SELECT,
    });
    await this.writeRows(customerId, rows.map(toMatched), (r) => ({
      name: r.name,
      category,
    }));
  }

  /**
   * The category a name already has for this customer: their own choice, else the firm
   * memory's, else what most of their rows of it are in. Null for a name new to everyone.
   */
  private async categoryOfName(
    customerId: number,
    name: string,
  ): Promise<string | null> {
    const key = nameKey(name);
    const own = indexRules(await this.rulesOf(customerId)).nameCategories.get(
      key,
    );
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
      where: { customerId, name: key, splitOfId: null },
      _count: { _all: true },
    });
    const usual = groups
      .filter((g) => g.offsetAccount !== UNCATEGORIZED)
      .sort((a, b) => b._count._all - a._count._all)[0];
    return usual?.offsetAccount ?? null;
  }

  /** The key to edit a payee under: its existing NAME rule's (rename target or key), else its own. */
  private async ruleKeyForName(
    customerId: number,
    name: string,
  ): Promise<string> {
    const key = nameKey(name);
    const rules = await this.prisma.customerNameRule.findMany({
      where: { customerId, matchType: 'NAME' },
      select: { matchKey: true, name: true },
    });
    const hit = rules.find(
      (r) => r.matchKey === key || (r.name && nameKey(r.name) === key),
    );
    return hit?.matchKey ?? key;
  }

  /**
   * Remove a customer's rule: their rows go back to what the firm memory says for each
   * description (and keep what they have where the memory knows nothing). One-time edits
   * stay as they are.
   */
  async resetRule(
    customerId: number,
    input: { matchType: RuleMatchType; matchKey: string },
  ): Promise<void> {
    const matchKey = ruleKeyOf(input.matchType, input.matchKey);
    const where = {
      customerId_matchType_matchKey: {
        customerId,
        matchType: input.matchType,
        matchKey,
      },
    };
    const rule = await this.prisma.customerNameRule.findUnique({ where });
    if (!rule) throw new NotFoundException('That name has no saved change');
    await this.prisma.customerNameRule.delete({ where });

    const names = new Set<string>([matchKey]);
    if (rule.name) names.add(nameKey(rule.name));
    const rows = await this.matchingRows(
      customerId,
      input.matchType,
      matchKey,
      names,
      false,
    );
    if (!rows.length) return;
    // Re-resolve WITHOUT the deleted rule — any other rule of theirs still applies.
    const ctx = await this.contextFor(
      customerId,
      rows.map((r) => r.description),
      rows.map((r) => r.name),
    );
    await this.writeRows(customerId, rows, (row) => {
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

  private async matchingRows(
    customerId: number,
    matchType: RuleMatchType,
    matchKey: string,
    names: ReadonlySet<string>,
    includeManual: boolean,
  ): Promise<MatchedRow[]> {
    // Splits are a receipt's items or the customer's own parts: never a rule's rows.
    const manual = includeManual
      ? { splitOfId: null }
      : { manualEdit: false, splitOfId: null };
    if (matchType === 'NAME') {
      // MySQL compares names case-insensitively, which is what a NAME key means.
      const rows = await this.prisma.bankTransaction.findMany({
        where: { customerId, name: { in: [...names] }, ...manual },
        select: MATCH_SELECT,
      });
      return rows.map(toMatched);
    }
    const rows = await this.prisma.bankTransaction.findMany({
      where: { customerId, ...manual },
      select: MATCH_SELECT,
    });
    return rows
      .filter((r) => descriptionKey(r.description) === matchKey)
      .map(toMatched);
  }

  /**
   * Apply `next` to these rows, then re-decide THEIR taxes at once (`TaxService.retagRows`),
   * so the ledger, the chart of accounts and the income statement are right as soon as the
   * request returns — no Generate. A failed re-tag leaves the "Generate" hint instead.
   * `manual` flags the rows as a one-time edit (or, false, leaves the flag as it is).
   */
  private async writeRows(
    customerId: number,
    rows: MatchedRow[],
    next: (row: MatchedRow) => { name: string | null; category: string },
    manual = false,
  ): Promise<void> {
    const changed: number[] = [];
    const updates = rows.flatMap((row) => {
      const { name, category } = next(row);
      if (name === row.name && category === row.offsetAccount) return [];
      changed.push(row.id);
      // The bank side never changes; only the offset does, so re-derive both columns.
      const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
      return [
        this.prisma.bankTransaction.update({
          where: { id: row.id },
          data: {
            name,
            offsetAccount: category,
            ...doubleEntry(row.amount, bank, category),
            ...(manual && { manualEdit: true }),
          },
        }),
      ];
    });
    if (!updates.length) return;
    await this.prisma.$transaction(updates);
    // A new category can change which rows are taxed, and how.
    await this.tax.retagRows(customerId, changed);
  }

  private async carryTaxSwitch(
    customerId: number,
    oldNames: string[],
    newName: string,
  ): Promise<void> {
    const exempt = await this.prisma.ledgerName.findFirst({
      where: { customerId, name: { in: oldNames }, taxExempt: true },
      select: { id: true },
    });
    if (!exempt) return;
    await this.prisma.ledgerName.upsert({
      where: { customerId_name: { customerId, name: newName } },
      create: { customerId, name: newName, taxExempt: true },
      update: { taxExempt: true },
    });
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
} as const;

const ruleKeyOf = (matchType: RuleMatchType, raw: string): string =>
  matchType === 'NAME'
    ? nameKey(raw)
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
}

function toMatched(r: {
  id: number;
  description: string;
  name: string | null;
  amount: { toString(): string };
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
}): MatchedRow {
  return {
    id: r.id,
    description: r.description,
    name: r.name,
    amount: Number(r.amount.toString()),
    offsetAccount: r.offsetAccount,
    debitAccount: r.debitAccount,
    creditAccount: r.creditAccount,
  };
}
