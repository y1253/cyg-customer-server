import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeAccount, UNCATEGORIZED } from './chart-of-accounts';
import { CustomerAccountsService } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { cleanName } from './name-memory.util';
import {
  accountTypeOf,
  analyze,
  cleanTxns,
  isUncategorizedQbo,
  nameKey,
  type BookRow,
  type ExistingRule,
  type ImportAnalysis,
} from './qbo-import.util';
import { bookLabel, scopeWhere, type BookScope } from './scope';
import { ensureSubName, wrapperNames } from './sub-name-parents';

/** What the admin decided — the rules to make (built by the internal API). */
export interface ImportPlan {
  categories: Array<{ name: string; type: string | null }>;
  names: Array<{
    payee: string;
    /** Our names renamed to the payee. */
    aliases: string[];
    /** Its one category; null = none. */
    category: string | null;
    /** Sub-names instead of one category: each description → its category. */
    split: Array<{ key: string; category: string }> | null;
    /** The categories it gets a sub-name for (split only). */
    splitCategories: string[];
  }>;
  descriptions: Array<{ key: string; payee: string; category: string | null }>;
}

export interface ImportResult {
  rules: number;
  categoriesCreated: string[];
  subNames: number;
  errors: string[];
}

const str = (v: unknown, max = 191): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * step11.md (2026-11-25): the QuickBooks import on the customer side — the book's rows and
 * rules for the analysis, and the rules the admin's answers make. Called only by the
 * internal API (`/api/staff/books/:companyId/qbo-import/*`).
 */
@Injectable()
export class QboImportService {
  private readonly logger = new Logger(QboImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
    private readonly names: NameMemoryService,
  ) {}

  async analyze(
    scope: BookScope,
    input: { since?: unknown; txns?: unknown },
  ): Promise<ImportAnalysis> {
    const since =
      typeof input.since === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input.since)
        ? input.since.slice(0, 10)
        : null;
    const txns = cleanTxns(input.txns);
    const [rows, rules] = await Promise.all([
      this.rowsSince(scope, since),
      this.rules(scope),
    ]);
    const result = analyze({ since, txns, rows, rules });
    this.logger.log(
      `${bookLabel(scope)}: QuickBooks import analysed ${txns.length} transaction(s), ` +
        `${result.stats.matched} matched, ${result.names.length} payee(s), ` +
        `${result.questions.length} question(s)`,
    );
    return result;
  }

  private async rowsSince(
    scope: BookScope,
    since: string | null,
  ): Promise<BookRow[]> {
    const from = since ? new Date(`${since}T00:00:00Z`) : null;
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        ...scopeWhere(scope),
        splitOfId: null,
        statement: { status: 'DONE', deletedAt: null },
        ...(from
          ? {
              OR: [
                { postingDate: { gte: from } },
                { pendingDate: { gte: from } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        postingDate: true,
        pendingDate: true,
        amount: true,
        description: true,
        name: true,
        offsetAccount: true,
        statement: {
          select: {
            accountName: true,
            plaidAccount: { select: { qboAccountId: true } },
          },
        },
      },
    });
    return rows.map((r) => {
      const date = r.postingDate ?? r.pendingDate;
      return {
        id: r.id,
        date: date ? date.toISOString().slice(0, 10) : null,
        cents: Math.round(Number(r.amount) * 100),
        description: r.description,
        name: r.name,
        category: r.offsetAccount,
        qboAccountId: r.statement.plaidAccount?.qboAccountId ?? null,
        accountName: r.statement.accountName,
      };
    });
  }

  private async rules(scope: BookScope): Promise<ExistingRule[]> {
    const rows = await this.prisma.customerNameRule.findMany({
      where: {
        ...scopeWhere(scope),
        matchType: { in: ['NAME', 'DESCRIPTION'] },
      },
      select: { matchType: true, matchKey: true, name: true, category: true },
    });
    return rows.map((r) => ({
      matchType: r.matchType === 'NAME' ? 'NAME' : 'DESCRIPTION',
      matchKey: r.matchKey,
      name: r.name,
      category: r.category,
    }));
  }

  /**
   * Makes the rules. Order matters: categories first (a rule may only name a category the
   * book has), then the sub-names of split payees (so their description rules can point at
   * them), then renames, categories and description rules — all saved by `NameMemoryService`
   * the way the customer's own edits are, so their rows are re-filed now.
   */
  async apply(scope: BookScope, raw: unknown): Promise<ImportResult> {
    const plan = cleanPlan(raw);
    const errors: string[] = [];
    const { map, created } = await this.categories(
      scope,
      plan.categories,
      errors,
    );
    const ours = (c: string | null): string | null =>
      c ? (map.get(c.toLowerCase()) ?? null) : null;

    // Sub-names of the split payees.
    let subNames = 0;
    const subOf = new Map<string, number>(); // `${payeeKey}\u0000${category}` → id
    const ensure = async (
      payee: string,
      category: string,
    ): Promise<number | null> => {
      const k = `${nameKey(payee)}\u0000${category.toLowerCase()}`;
      const known = subOf.get(k);
      if (known) return known;
      try {
        const sub = await ensureSubName(this.prisma, scope, payee, category);
        subOf.set(k, sub.id);
        subNames++;
        return sub.id;
      } catch (err) {
        errors.push(`sub-name ${payee} - ${category}: ${String(err)}`);
        return null;
      }
    };
    for (const n of plan.names) {
      if (!n.split) continue;
      for (const c of n.splitCategories) {
        const cat = ours(c);
        if (cat && cat !== UNCATEGORIZED) await ensure(n.payee, cat);
      }
    }
    const wrappers = await wrapperNames(this.prisma, scope);

    type Op = Parameters<NameMemoryService['saveImported']>[1][number];
    const ops: Op[] = [];
    for (const n of plan.names) {
      for (const alias of n.aliases) {
        if (nameKey(alias) === nameKey(n.payee)) continue;
        ops.push({
          kind: 'RULE',
          input: {
            matchType: 'NAME',
            matchKey: alias,
            name: n.payee,
            category: null,
            scope: 'ALWAYS',
          },
        });
      }
      if (n.split) {
        for (const d of n.split) {
          const cat = ours(d.category);
          if (!cat || cat === UNCATEGORIZED) continue;
          const subNameId = await ensure(n.payee, cat);
          if (!subNameId) continue;
          ops.push({
            kind: 'RULE',
            input: {
              matchType: 'DESCRIPTION',
              matchKey: d.key,
              name: n.payee,
              category: null,
              scope: 'ALWAYS',
              replace: true,
              subNameId,
            },
          });
        }
        continue;
      }
      const cat = ours(n.category);
      if (cat && cat !== UNCATEGORIZED) {
        if (wrappers.has(nameKey(n.payee))) {
          errors.push(
            `${n.payee} has sub-names, so its category is set on each sub-name — left as it is`,
          );
        } else {
          ops.push({ kind: 'CATEGORY', name: n.payee, category: cat });
        }
      }
    }
    for (const d of plan.descriptions) {
      const cat = ours(d.category);
      // A payee with sub-names takes a description only into one of them.
      let subNameId: number | null = null;
      const payeeKey = nameKey(d.payee);
      const isWrapper =
        wrappers.has(payeeKey) ||
        [...subOf.keys()].some((k) => k.startsWith(`${payeeKey}\u0000`));
      if (isWrapper) {
        if (!cat || cat === UNCATEGORIZED) {
          errors.push(
            `“${d.key}”: ${d.payee} has sub-names and QuickBooks gave no one category — left as it is`,
          );
          continue;
        }
        subNameId = await ensure(d.payee, cat);
        if (!subNameId) continue;
      }
      ops.push({
        kind: 'RULE',
        input: {
          matchType: 'DESCRIPTION',
          matchKey: d.key,
          name: d.payee,
          category: subNameId
            ? null
            : cat && cat !== UNCATEGORIZED
              ? cat
              : null,
          scope: 'ALWAYS',
          replace: true,
          subNameId,
        },
      });
    }

    errors.push(...(await this.names.saveImported(scope, ops)));
    this.logger.log(
      `${bookLabel(scope)}: QuickBooks import saved ${ops.length} rule(s), ` +
        `${created.length} new categor${created.length === 1 ? 'y' : 'ies'}, ` +
        `${subNames} sub-name(s), ${errors.length} problem(s)`,
    );
    return {
      rules: ops.length,
      categoriesCreated: created,
      subNames,
      errors,
    };
  }

  /**
   * QuickBooks' categories as ours: a chart account (any case) as it is, QuickBooks'
   * uncategorized ones as Uncategorized, anything else made one of the book's own.
   */
  private async categories(
    scope: BookScope,
    list: ImportPlan['categories'],
    errors: string[],
  ): Promise<{ map: Map<string, string>; created: string[] }> {
    const own = new Set(
      (await this.accounts.list(scope))
        .filter((a) => a.custom)
        .map((a) => a.name),
    );
    const map = new Map<string, string>();
    const created: string[] = [];
    for (const c of list) {
      const name = cleanName(c.name);
      if (!name) continue;
      if (isUncategorizedQbo(name)) {
        map.set(name.toLowerCase(), UNCATEGORIZED);
        continue;
      }
      const known = normalizeAccount(name, own);
      if (known !== UNCATEGORIZED) {
        map.set(name.toLowerCase(), known);
        continue;
      }
      try {
        const made = await this.accounts.create(scope, {
          name,
          type: accountTypeOf(c.type),
        });
        own.add(made.name);
        created.push(made.name);
        map.set(name.toLowerCase(), made.name);
      } catch (err) {
        errors.push(
          `category “${name}”: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { map, created };
  }
}

/** The plan as sent, cleaned: anything malformed is dropped. */
export function cleanPlan(raw: unknown): ImportPlan {
  const p = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v)
      ? (v as Array<Record<string, unknown>>).filter(
          (x) => x && typeof x === 'object',
        )
      : [];
  return {
    categories: arr(p.categories)
      .map((c) => ({
        name: str(c.name, 120),
        type: typeof c.type === 'string' ? c.type : null,
      }))
      .filter((c) => c.name),
    names: arr(p.names)
      .map((n) => ({
        payee: str(n.payee, 100),
        aliases: Array.isArray(n.aliases)
          ? (n.aliases as unknown[]).map((a) => str(a)).filter(Boolean)
          : [],
        category: str(n.category, 120) || null,
        split: Array.isArray(n.split)
          ? arr(n.split)
              .map((d) => ({
                key: str(d.key, 255),
                category: str(d.category, 120),
              }))
              .filter((d) => d.key && d.category)
          : null,
        splitCategories: Array.isArray(n.splitCategories)
          ? (n.splitCategories as unknown[])
              .map((c) => str(c, 120))
              .filter(Boolean)
          : [],
      }))
      .filter((n) => n.payee),
    descriptions: arr(p.descriptions)
      .map((d) => ({
        key: str(d.key, 255),
        payee: str(d.payee, 100),
        category: str(d.category, 120) || null,
      }))
      .filter((d) => d.key && d.payee),
  };
}
