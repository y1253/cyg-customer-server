import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UNCATEGORIZED, normalizeAccount } from './chart-of-accounts';
import { doubleEntry, type ExtractedTransaction } from './ledger.util';
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
 * The two memories of what a transaction is called and how it is categorised:
 *
 * - `DescriptionMemory` — FIRM-WIDE, what the AI concluded for a description the first time
 *   it saw it. Reused for every customer, and it outlives the statement it came from.
 * - `CustomerNameRule` — one customer's OWN edits from the Names tab, which win over both
 *   the memory and the AI for that customer only.
 *
 * The rules themselves are pure (`name-memory.util.ts`); this is only the IO around them.
 */
@Injectable()
export class NameMemoryService {
  private readonly logger = new Logger(NameMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Everything `resolveRow` needs for these descriptions: two queries, whatever the count. */
  async contextFor(
    customerId: number,
    descriptions: readonly string[],
  ): Promise<ResolveContext> {
    const keys = [...new Set(descriptions.map(descriptionKey).filter(Boolean))];
    const [memoryRows, rules] = await Promise.all([
      keys.length
        ? this.prisma.descriptionMemory.findMany({
            where: { descriptionKey: { in: keys } },
            select: { descriptionKey: true, name: true, category: true },
          })
        : Promise.resolve([]),
      this.rulesOf(customerId),
    ]);
    const memory = new Map<string, MemoryEntry>(
      memoryRows.map((m) => [
        m.descriptionKey,
        { name: m.name, category: m.category },
      ]),
    );
    return { memory, ...indexRules(rules) };
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

  /**
   * A freshly read statement: resolve every row against the customer's rules and the firm
   * memory, and teach the memory the AI's new answers. Returns the rows to write.
   *
   * Never throws — a memory outage must not fail a statement the AI has already paid to
   * read; the rows then keep the AI's own answers.
   */
  async resolveStatement(
    customerId: number,
    rows: ExtractedTransaction[],
  ): Promise<ExtractedTransaction[]> {
    try {
      const ctx = await this.contextFor(
        customerId,
        rows.map((r) => r.description),
      );
      const resolved = rows.map((r) => {
        const out = resolveRow(r, ctx);
        return { ...r, name: out.name, offsetAccount: out.category };
      });
      await this.learn(rows, ctx.memory);
      return resolved;
    } catch (err) {
      this.logger.warn(
        `name memory unavailable for customer ${customerId}, keeping the AI's answers: ${String(err)}`,
      );
      return rows;
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
   * Save a customer's own name/category and apply it to every row of theirs it matches —
   * so the ledger, exports and reports show it at once, and every statement read from now
   * on gets it too.
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
    },
  ): Promise<void> {
    const matchKey =
      input.matchType === 'NAME'
        ? nameKey(input.matchKey)
        : descriptionKey(input.matchKey) || input.matchKey.trim().toLowerCase();
    const name = cleanName(input.name);
    const category = input.category ? normalizeAccount(input.category) : null;
    const where = {
      customerId_matchType_matchKey: {
        customerId,
        matchType: input.matchType,
        matchKey,
      },
    };
    const previous = await this.prisma.customerNameRule.findUnique({ where });

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

    // Rows this rule covers now: for a NAME rule, those still carrying the original name
    // AND those an earlier version of the rule already renamed.
    const names = new Set<string>([matchKey]);
    if (previous?.name) names.add(nameKey(previous.name));
    await this.rewrite(customerId, input.matchType, matchKey, names, (row) => ({
      name: name ?? row.name,
      category: category ?? row.offsetAccount,
    }));

    // "Tax applies" lives on the payee NAME, so a rename carries it over.
    if (name && input.matchType === 'NAME') {
      await this.carryTaxSwitch(customerId, [...names], name);
    }
  }

  /**
   * Remove a customer's rule: their rows go back to what the firm memory says for each
   * description (and keep what they have where the memory knows nothing).
   */
  async resetRule(
    customerId: number,
    input: { matchType: RuleMatchType; matchKey: string },
  ): Promise<void> {
    const matchKey =
      input.matchType === 'NAME'
        ? nameKey(input.matchKey)
        : descriptionKey(input.matchKey) || input.matchKey.trim().toLowerCase();
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

  /** Apply `next` to every row the rule matches; marks the customer's taxes stale. */
  private async rewrite(
    customerId: number,
    matchType: RuleMatchType,
    matchKey: string,
    names: ReadonlySet<string>,
    next: (row: MatchedRow) => { name: string | null; category: string },
  ): Promise<void> {
    const rows = await this.matchingRows(
      customerId,
      matchType,
      matchKey,
      names,
    );
    await this.writeRows(customerId, rows, next);
  }

  private async matchingRows(
    customerId: number,
    matchType: RuleMatchType,
    matchKey: string,
    names: ReadonlySet<string>,
  ): Promise<MatchedRow[]> {
    const select = {
      id: true,
      description: true,
      name: true,
      amount: true,
      offsetAccount: true,
      debitAccount: true,
      creditAccount: true,
    } as const;
    if (matchType === 'NAME') {
      // MySQL compares names case-insensitively, which is what a NAME key means.
      const rows = await this.prisma.bankTransaction.findMany({
        where: { customerId, name: { in: [...names] } },
        select,
      });
      return rows.map(toMatched);
    }
    const rows = await this.prisma.bankTransaction.findMany({
      where: { customerId },
      select,
    });
    return rows
      .filter((r) => descriptionKey(r.description) === matchKey)
      .map(toMatched);
  }

  private async writeRows(
    customerId: number,
    rows: MatchedRow[],
    next: (row: MatchedRow) => { name: string | null; category: string },
  ): Promise<void> {
    const updates = rows.flatMap((row) => {
      const { name, category } = next(row);
      if (name === row.name && category === row.offsetAccount) return [];
      // The bank side never changes; only the offset does, so re-derive both columns.
      const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
      return [
        this.prisma.bankTransaction.update({
          where: { id: row.id },
          data: {
            name,
            offsetAccount: category,
            ...doubleEntry(row.amount, bank, category),
          },
        }),
      ];
    });
    if (!updates.length) return;
    await this.prisma.$transaction([
      ...updates,
      // A new category can change which rows are taxed — Generate re-tags.
      this.prisma.customer.update({
        where: { id: customerId },
        data: { taxStale: true },
      }),
    ]);
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
  return { ...r, amount: Number(r.amount.toString()) };
}
