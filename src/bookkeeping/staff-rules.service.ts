import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CustomerAccountsService,
  type AccountView,
} from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { cleanName, descriptionKey, nameKey } from './name-memory.util';
import { scopeWhere, type BookScope } from './scope';

/** One of the customer's name / description rules, as staff see it. */
export interface StaffNameRuleView {
  id: number;
  matchType: 'NAME' | 'DESCRIPTION';
  /** The payee name (NAME) or the description key (DESCRIPTION) the rule matches. */
  matchKey: string;
  /** A real bank description it matches — the key alone has its digits stripped. */
  example: string | null;
  /** The name it gives; null = leaves the name as it is. */
  name: string | null;
  /** Its own category; null = leaves it (or, with a name, the name's category). */
  category: string | null;
  /** The category the rows end up in: its own, else the name's. */
  effectiveCategory: string | null;
  /** Ledger rows it covers now. */
  rows: number;
  updatedAt: string;
}

export interface StaffItemRuleView {
  id: number;
  itemKey: string;
  category: string;
  updatedAt: string;
}

export interface StaffRulesView {
  descriptions: StaffNameRuleView[];
  names: StaffNameRuleView[];
  items: StaffItemRuleView[];
  /** What a category may be set to: the chart plus the customer's own. */
  categories: AccountView[];
}

/**
 * The customer's own rules for ONE company's book, read for the internal "Rules" tab
 * (step2). Edits do NOT happen here — they go through `NameMemoryService` /
 * `ProductMemoryService` exactly as the customer's own do, so the rows are re-filed the
 * same way.
 */
@Injectable()
export class StaffRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
    private readonly nameMemory: NameMemoryService,
  ) {}

  async view(scope: BookScope): Promise<StaffRulesView> {
    const [rules, items, rows, categories] = await Promise.all([
      this.prisma.customerNameRule.findMany({
        where: scopeWhere(scope),
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.customerItemRule.findMany({
        where: scopeWhere(scope),
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), splitOfId: null },
        select: { description: true, name: true },
      }),
      this.accounts.list(scope),
    ]);

    const byDescription = new Map<string, { rows: number; example: string }>();
    const byName = new Map<string, number>();
    for (const r of rows) {
      const key = descriptionKey(r.description);
      if (key) {
        const hit = byDescription.get(key);
        if (hit) hit.rows++;
        else byDescription.set(key, { rows: 1, example: r.description });
      }
      const name = cleanName(r.name);
      if (name) byName.set(nameKey(name), (byName.get(nameKey(name)) ?? 0) + 1);
    }

    const views = await Promise.all(
      rules.map(async (r): Promise<StaffNameRuleView> => {
        const name = cleanName(r.name);
        const description =
          r.matchType === 'DESCRIPTION'
            ? byDescription.get(r.matchKey)
            : undefined;
        const names = new Set([r.matchKey, ...(name ? [nameKey(name)] : [])]);
        const rowCount =
          r.matchType === 'DESCRIPTION'
            ? (description?.rows ?? 0)
            : [...names].reduce((n, k) => n + (byName.get(k) ?? 0), 0);
        return {
          id: r.id,
          matchType: r.matchType === 'NAME' ? 'NAME' : 'DESCRIPTION',
          matchKey: r.matchKey,
          example: description?.example ?? null,
          name,
          category: r.category,
          effectiveCategory:
            r.category ??
            (name ? await this.nameMemory.categoryOfName(scope, name) : null),
          rows: rowCount,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    );

    return {
      descriptions: views.filter((v) => v.matchType === 'DESCRIPTION'),
      names: views.filter((v) => v.matchType === 'NAME'),
      items: items.map((i) => ({
        id: i.id,
        itemKey: i.itemKey,
        category: i.category,
        updatedAt: i.updatedAt.toISOString(),
      })),
      categories,
    };
  }
}
