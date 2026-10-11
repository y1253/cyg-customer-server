import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UNCATEGORIZED, normalizeAccount } from './chart-of-accounts';
import { doubleEntry, type ExtractedTransaction } from './ledger.util';
import { TaxService } from './tax.service';
import {
  cleanName,
  descriptionKey,
  indexRules,
  memoryWrites,
  nameKey,
  resolveRow,
  type MemoryEntry,
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

  /** Everything `resolveRow` needs for these descriptions: three queries, whatever the count. */
  async contextFor(
    customerId: number,
    descriptions: readonly string[],
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
    return { memory, ...indexRules(rules), customAccounts };
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
  ): Promise<{ lines: ExtractedTransaction[]; customAccounts: Set<string> }> {
    try {
      const ctx = await this.contextFor(
        customerId,
        rows.map((r) => r.description),
      );
      const lines = rows.map((r) => {
        const out = resolveRow(r, ctx);
        return { ...r, name: out.name, offsetAccount: out.category };
      });
      await this.learn(rows, ctx.memory);
      return { lines, customAccounts: ctx.customAccounts };
    } catch (err) {
      this.logger.warn(
        `name memory unavailable for customer ${customerId}, keeping the AI's answers: ${String(err)}`,
      );
      return { lines: rows, customAccounts: new Set() };
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

  /**
   * A change from the Names tab.
   *
   * `ALWAYS`: saved as the customer's rule and applied to every row of theirs it matches —
   * so the ledger, exports and reports show it at once, and every statement read from now on
   * gets it too. Rows a ONE-TIME edit touched (`manualEdit`) are left alone.
   *
   * `ONCE`: the same rows are changed now and flagged `manualEdit`; nothing is saved, so the
   * next statement is read as before.
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
    const scope = input.scope ?? 'ALWAYS';
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

    if (scope === 'ALWAYS') {
      await this.prisma.customerNameRule.upsert({
        where,
        create: {
          customerId,
          matchType: input.matchType,
          matchKey,
          name,
          category,
        },
        update: { name, category },
      });
    }

    // Rows this change covers now: for a NAME rule, those still carrying the original name
    // AND those an earlier version of the rule already renamed.
    const names = new Set<string>([matchKey]);
    if (previous?.name) names.add(nameKey(previous.name));
    const rows = await this.matchingRows(
      customerId,
      input.matchType,
      matchKey,
      names,
      // A one-time change is the customer acting on these rows directly — it reaches the
      // ones an earlier one-time change touched. A saved rule does not.
      scope === 'ONCE',
    );
    await this.writeRows(
      customerId,
      rows,
      (row) => ({
        name: name ?? row.name,
        category: category ?? row.offsetAccount,
      }),
      scope === 'ONCE',
    );

    // "Tax applies" lives on the payee NAME, so a rename carries it over.
    if (name && input.matchType === 'NAME') {
      await this.carryTaxSwitch(customerId, [...names], name);
    }
  }

  /**
   * A change made on ONE ledger row (its Name or Category cell).
   *
   * `ONCE`: only that row changes, and is flagged `manualEdit`.
   * `ALWAYS`: saved as a rule for the row's payee (a NAME rule; a DESCRIPTION rule when the
   * row has no name), so every matching row and every later statement follow it — and the
   * clicked row itself, even if an earlier one-time edit had flagged it.
   */
  async editTransaction(
    customerId: number,
    id: number,
    input: { name: string | null; category: string | null; scope: EditScope },
  ): Promise<void> {
    const row = await this.prisma.bankTransaction.findFirst({
      where: { id, customerId },
      select: { ...MATCH_SELECT, manualEdit: true },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    const custom = await this.customAccountsOf(customerId);
    const name = cleanName(input.name);
    const category = input.category
      ? normalizeAccount(input.category, custom)
      : null;
    const matched = toMatched(row);
    const next = (r: MatchedRow) => ({
      name: name ?? r.name,
      category: category ?? r.offsetAccount,
    });

    if (input.scope === 'ONCE') {
      await this.writeRows(customerId, [matched], next, true);
      return;
    }

    if (row.name) {
      await this.saveRule(customerId, {
        matchType: 'NAME',
        matchKey: await this.ruleKeyForName(customerId, row.name),
        name,
        category,
      });
    } else {
      const key = descriptionKey(row.description);
      if (!key) {
        throw new BadRequestException(
          'This transaction has no description to remember. Change it for this row only.',
        );
      }
      await this.saveRule(customerId, {
        matchType: 'DESCRIPTION',
        matchKey: key,
        name,
        category,
      });
    }
    // The clicked row too, even when an earlier one-time edit flagged it.
    if (row.manualEdit) await this.writeRows(customerId, [matched], next);
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
    const manual = includeManual ? {} : { manualEdit: false };
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
