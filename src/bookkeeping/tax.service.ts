import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StatementStatus,
  type Prisma,
  type TaxAgency,
  type TaxAgencyRate,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCOUNT_NAMES,
  typeFor,
  UNCATEGORIZED,
  type TypeContext,
} from './chart-of-accounts';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  descriptionKey,
  nameKey,
  type RuleMatchType,
} from './name-memory.util';
import { UNCLARIFIED_NAME } from './reports.util';
import { scopeWhere, type BookScope } from './scope';
import { remainderOf, splitTotals } from './splits.util';
import type {
  AgencyRateDto,
  CreateAgencyDto,
  UpdateAgencyDto,
} from './dto/agency.dto';
import {
  nameTaxKey,
  nameTaxLines,
  taxAmount,
  type Agency,
  type TaxKind,
} from './tax.util';

export interface AgencyView {
  id: number;
  name: string;
  /** At most one per kind, SALES first. */
  rates: Array<{ kind: TaxKind; rate: number }>;
  active: boolean;
}

/** What a payee is, from its category: income → customer, expense → supplier. */
export type NameType = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

/** One payee name on the Names tab. */
export interface NameView {
  name: string;
  /** Its most frequent category (offset account). */
  category: string;
  /** How many other categories its rows have. */
  otherCategories: number;
  type: NameType;
  rows: number;
  /** The tax agencies that tax this name's rows (none = not taxed, the default). */
  agencyIds: number[];
  /**
   * The descriptions the AI put under this name (one per description key, most rows first,
   * at most `MAX_DESCRIPTIONS`), with the category their rows mostly have.
   */
  descriptions: Array<{ description: string; category: string; rows: number }>;
  /** What an edit of this row saves under: a NAME rule with this key. */
  ruleKey: string;
  /** The customer's own rule behind this row, if any — what "Reset to default" removes. */
  rule: { matchType: RuleMatchType; matchKey: string } | null;
  /**
   * The rows the AI found NO payee for, listed as one name ("Unclarified name"). Never
   * stored: the rows keep `name = null`, and each description is assigned from
   * `NamesView.unrecognized`.
   */
  unclarified?: true;
}

/** Rows the AI found no payee name for, grouped by description, on the Names tab. */
export interface UnrecognizedView {
  /** The description key — what an assignment saves under (a DESCRIPTION rule). */
  key: string;
  /** One of the descriptions, as printed. */
  sampleDescription: string;
  category: string;
  otherCategories: number;
  rows: number;
  rule: { matchType: RuleMatchType; matchKey: string } | null;
}

export interface NamesView {
  names: NameView[];
  unrecognized: UnrecognizedView[];
}

/** One tax line on a row, as the ledger, exports and reports read it. */
export interface StoredTax {
  agencyId: number;
  agency: string;
  /** The customer's own name for the line; null = the transaction's name. */
  name: string | null;
  kind: TaxKind;
  rate: number;
  /** Included in the bank amount, positive (display only — readers split by `rate`). */
  amount: number;
}

export interface TaxSettingsView {
  agencies: AgencyView[];
}

const KIND_ORDER: TaxKind[] = ['SALES', 'PURCHASE'];

const toAgency = (a: TaxAgency & { rates: TaxAgencyRate[] }): AgencyView => ({
  id: a.id,
  name: a.name,
  rates: KIND_ORDER.flatMap((kind) => {
    const r = a.rates.find((x) => x.kind === kind);
    return r ? [{ kind, rate: Number(r.rate) }] : [];
  }),
  active: a.active,
});

/** The rates as stored; one kind given twice is refused. */
function rateRows(rates: AgencyRateDto[]) {
  if (new Set(rates.map((r) => r.kind)).size !== rates.length) {
    throw new BadRequestException('Give each kind of tax only one rate');
  }
  return rates.map((r) => ({ kind: r.kind, rate: r.rate.toFixed(3) }));
}

const typeOfCategory = (category: string, ctx: TypeContext): NameType => {
  const type = typeFor(category, ctx);
  if (type === 'INCOME') return 'CUSTOMER';
  if (type === 'EXPENSE') return 'SUPPLIER';
  return 'OTHER';
};

const DONE = { deletedAt: null, status: StatementStatus.DONE };

/**
 * Sales tax: the customer's agencies and which NAMES each one taxes (`LedgerNameAgency`).
 * There is no AI step and no switch (user's decision 2026-10-14): a row is taxed by the
 * agencies picked for its payee name, computed on READ (`linesFor`) — the single choke
 * point for the ledger, both exports and the reports — so a change shows at once.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
  ) {}

  // ---- agencies ----

  async settings(scope: BookScope): Promise<TaxSettingsView> {
    const agencies = await this.prisma.taxAgency.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      include: { rates: true },
      orderBy: { createdAt: 'asc' },
    });
    return { agencies: agencies.map(toAgency) };
  }

  async createAgency(
    scope: BookScope,
    dto: CreateAgencyDto,
  ): Promise<AgencyView> {
    const name = await this.checkName(scope, dto.name);
    const row = await this.prisma.taxAgency.create({
      data: {
        ...scopeWhere(scope),
        name,
        active: dto.active ?? true,
        rates: { create: rateRows(dto.rates) },
      },
      include: { rates: true },
    });
    return toAgency(row);
  }

  async updateAgency(
    scope: BookScope,
    id: number,
    dto: UpdateAgencyDto,
  ): Promise<AgencyView> {
    await this.ownedAgency(scope, id);
    const name =
      dto.name === undefined
        ? undefined
        : await this.checkName(scope, dto.name, id);
    const rates = dto.rates && rateRows(dto.rates);
    const row = await this.prisma.taxAgency.update({
      where: { id },
      data: {
        name,
        active: dto.active,
        // Replaces every rate: deleteMany then create, in the same update.
        ...(rates && { rates: { deleteMany: {}, create: rates } }),
      },
      include: { rates: true },
    });
    return toAgency(row);
  }

  /** Soft delete; the names it taxed lose it (their `LedgerNameAgency` rows go). */
  async removeAgency(scope: BookScope, id: number): Promise<void> {
    await this.ownedAgency(scope, id);
    await this.prisma.$transaction([
      this.prisma.taxAgency.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      }),
      this.prisma.ledgerNameAgency.deleteMany({
        where: { ...scopeWhere(scope), agencyId: id },
      }),
    ]);
  }

  private async ownedAgency(scope: BookScope, id: number) {
    const a = await this.prisma.taxAgency.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!a) throw new NotFoundException('Agency not found');
    return a;
  }

  /** The agency's name is an account name on the ledger — it must not collide. */
  private async checkName(
    scope: BookScope,
    raw: string,
    exceptId?: number,
  ): Promise<string> {
    const name = raw.trim();
    if (!name) throw new BadRequestException('Give the agency a name');
    const lower = name.toLowerCase();
    if (ACCOUNT_NAMES.some((n) => n.toLowerCase() === lower)) {
      throw new BadRequestException(
        `"${name}" is already an account name — choose another`,
      );
    }
    const others = await this.prisma.taxAgency.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        NOT: { id: exceptId ?? 0 },
      },
      select: { name: true },
    });
    if (others.some((o) => o.name.toLowerCase() === lower)) {
      throw new BadRequestException(`You already have an agency "${name}"`);
    }
    return name;
  }

  /** Every agency name — they are LIABILITY accounts in the reports. */
  async agencyNames(scope: BookScope): Promise<string[]> {
    const rows = await this.prisma.taxAgency.findMany({
      where: scopeWhere(scope),
      select: { name: true },
    });
    return rows.map((r) => r.name);
  }

  /** What decides an account's type for this customer (moves, own categories, agencies). */
  async typeContext(scope: BookScope): Promise<TypeContext> {
    const [overrides, custom, agencies] = await Promise.all([
      this.accounts.overrides(scope),
      this.accounts.types(scope),
      this.agencyNames(scope),
    ]);
    return { overrides, custom, liabilities: new Set(agencies) };
  }

  // ---- reading ----

  /**
   * The tax lines of the customer's DONE rows (and splits), per transaction id — decided
   * by each row's payee NAME (`nameTaxLines`), on read. `statementIds` narrows it.
   */
  linesFor(
    scope: BookScope,
    statementIds?: number[],
  ): Promise<Map<number, StoredTax[]>> {
    return this.compute(scope, {
      ...(statementIds?.length && { statementId: { in: statementIds } }),
    });
  }

  private async compute(
    scope: BookScope,
    where: Prisma.BankTransactionWhereInput,
  ): Promise<Map<number, StoredTax[]>> {
    const out = new Map<number, StoredTax[]>();
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: scopeWhere(scope),
      select: { name: true, agencyId: true },
    });
    if (!picks.length) return out;
    const [agencyRows, rows, named, ctx] = await Promise.all([
      this.prisma.taxAgency.findMany({
        where: { ...scopeWhere(scope), deletedAt: null, active: true },
        include: { rates: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bankTransaction.findMany({
        where: { ...where, ...scopeWhere(scope), statement: DONE },
        select: {
          id: true,
          name: true,
          offsetAccount: true,
          amount: true,
          splitOfId: true,
        },
      }),
      this.prisma.transactionTax.findMany({
        where: { ...scopeWhere(scope), name: { not: null } },
        select: { transactionId: true, agencyId: true, name: true },
      }),
      this.typeContext(scope),
    ]);
    const agencies: Agency[] = agencyRows.map((a) => ({
      id: a.id,
      name: a.name,
      rates: Object.fromEntries(a.rates.map((r) => [r.kind, Number(r.rate)])),
    }));
    const agenciesOf = new Map<string, number[]>();
    for (const p of picks) {
      const key = nameTaxKey(p.name);
      agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
    }
    // A split-off part is taxed on its own; its parent only on what is left of it.
    const totals = splitTotals(
      rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })),
    );
    const sized = rows.map((r) => ({
      id: r.id,
      name: r.name,
      offsetAccount: r.offsetAccount,
      amount: remainderOf({ ...r, amount: Number(r.amount) }, totals),
    }));
    const amountOf = new Map(sized.map((r) => [r.id, r.amount]));
    const nameOf = new Map(
      named.map((n) => [`${n.transactionId}:${n.agencyId}`, n.name]),
    );
    for (const [id, lines] of nameTaxLines(sized, agenciesOf, agencies, ctx)) {
      out.set(
        id,
        lines.map((l) => ({
          ...l,
          name: nameOf.get(`${id}:${l.agencyId}`) ?? null,
          amount: taxAmount(amountOf.get(id) ?? 0, l.rate),
        })),
      );
    }
    return out;
  }

  // ---- names ----

  /**
   * The Names tab: every payee name on the customer's DONE statements (with its most
   * frequent category, the type that category makes it, its tax agencies and the
   * customer's own rule behind it). The rows with NO name are listed as one more name,
   * "Unclarified name" (Uncategorized, never stored), and grouped by description in
   * `unrecognized` so each can be assigned once.
   */
  async names(scope: BookScope): Promise<NamesView> {
    const [groups, named, nameless, picks, rules, ctx] = await Promise.all([
      this.prisma.bankTransaction.groupBy({
        by: ['name', 'offsetAccount'],
        where: { ...scopeWhere(scope), name: { not: null }, statement: DONE },
        _count: { _all: true },
      }),
      this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), name: { not: null }, statement: DONE },
        select: { name: true, description: true, offsetAccount: true },
      }),
      this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), name: null, statement: DONE },
        select: { description: true, offsetAccount: true },
      }),
      this.prisma.ledgerNameAgency.findMany({
        where: { ...scopeWhere(scope), agency: { deletedAt: null } },
        select: { name: true, agencyId: true },
        orderBy: { agencyId: 'asc' },
      }),
      this.prisma.customerNameRule.findMany({
        where: scopeWhere(scope),
        select: { matchType: true, matchKey: true, name: true },
      }),
      this.typeContext(scope),
    ]);
    const descriptionsOf = groupDescriptions(named);
    const agenciesOf = new Map<string, number[]>();
    for (const p of picks) {
      const key = nameTaxKey(p.name);
      agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
    }

    const ref = (r: { matchType: string; matchKey: string }) => ({
      matchType: (r.matchType === 'DESCRIPTION'
        ? 'DESCRIPTION'
        : 'NAME') as RuleMatchType,
      matchKey: r.matchKey,
    });
    // The rule behind a NAMED row: a NAME rule keyed on it or renaming to it, else a
    // DESCRIPTION rule that gave rows this name.
    const ruleForName = (key: string) => {
      const byName = rules.find(
        (r) =>
          r.matchType === 'NAME' &&
          (r.matchKey === key || (r.name && nameKey(r.name) === key)),
      );
      if (byName) return ref(byName);
      const byDesc = rules.find(
        (r) =>
          r.matchType === 'DESCRIPTION' && r.name && nameKey(r.name) === key,
      );
      return byDesc ? ref(byDesc) : null;
    };

    const byName = new Map<
      string,
      { name: string; categories: Array<[string, number]> }
    >();
    for (const g of groups) {
      if (!g.name) continue;
      const key = g.name.toLowerCase();
      const entry = byName.get(key) ?? { name: g.name, categories: [] };
      entry.categories.push([g.offsetAccount, g._count._all]);
      byName.set(key, entry);
    }
    const names = [...byName.entries()]
      .map(([key, { name, categories }]): NameView => {
        categories.sort((a, b) => b[1] - a[1]);
        const category = categories[0][0];
        const rule = ruleForName(key);
        return {
          name,
          category,
          otherCategories: categories.length - 1,
          type: typeOfCategory(category, ctx),
          rows: categories.reduce((n, [, c]) => n + c, 0),
          agencyIds: agenciesOf.get(nameTaxKey(name)) ?? [],
          descriptions: descriptionsOf.get(key) ?? [],
          ruleKey: rule?.matchType === 'NAME' ? rule.matchKey : key,
          rule,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const byKey = new Map<
      string,
      { sample: string; categories: Map<string, number> }
    >();
    for (const t of nameless) {
      const key = descriptionKey(t.description);
      if (!key) continue;
      const entry = byKey.get(key) ?? {
        sample: t.description,
        categories: new Map<string, number>(),
      };
      entry.categories.set(
        t.offsetAccount,
        (entry.categories.get(t.offsetAccount) ?? 0) + 1,
      );
      byKey.set(key, entry);
    }
    const unrecognized = [...byKey.entries()]
      .map(([key, { sample, categories }]): UnrecognizedView => {
        const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
        const descRule = rules.find(
          (r) => r.matchType === 'DESCRIPTION' && r.matchKey === key,
        );
        return {
          key,
          sampleDescription: sample,
          category: sorted[0][0],
          otherCategories: sorted.length - 1,
          rows: sorted.reduce((n, [, c]) => n + c, 0),
          rule: descRule ? ref(descRule) : null,
        };
      })
      .sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));

    // The nameless rows as one more name the customer can look up like any other
    // (user's request 2026-10-14). Its category is always Uncategorized — it is not a
    // payee, so it has no category of its own and nothing about it is stored.
    if (nameless.length) {
      names.push({
        name: UNCLARIFIED_NAME,
        category: UNCATEGORIZED,
        otherCategories: 0,
        type: 'OTHER',
        rows: nameless.length,
        agencyIds: agenciesOf.get(nameTaxKey(null)) ?? [],
        descriptions: unrecognized.slice(0, MAX_DESCRIPTIONS).map((u) => ({
          description: u.sampleDescription,
          category: u.category,
          rows: u.rows,
        })),
        ruleKey: '',
        rule: null,
        unclarified: true,
      });
      names.sort((a, b) => a.name.localeCompare(b.name));
    }

    return { names, unrecognized };
  }

  /**
   * Which agencies tax one name — the whole set (empty = not taxed). Applies on read
   * (`linesFor`), so the ledger, exports and reports show it at once.
   */
  async setNameAgencies(
    scope: BookScope,
    name: string,
    agencyIds: number[],
  ): Promise<NamesView> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Which name?');
    const ids = [...new Set(agencyIds)];
    if (ids.length) {
      const owned = await this.prisma.taxAgency.count({
        where: { ...scopeWhere(scope), deletedAt: null, id: { in: ids } },
      });
      if (owned !== ids.length) throw new NotFoundException('Agency not found');
    }
    const key = nameTaxKey(clean);
    const existing = await this.prisma.ledgerNameAgency.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true },
    });
    await this.prisma.$transaction([
      // MySQL compares case-insensitively; matched the same way here.
      this.prisma.ledgerNameAgency.deleteMany({
        where: {
          id: {
            in: existing
              .filter((e) => nameTaxKey(e.name) === key)
              .map((e) => e.id),
          },
        },
      }),
      this.prisma.ledgerNameAgency.createMany({
        data: ids.map((agencyId) => ({
          ...scopeWhere(scope),
          name: clean,
          agencyId,
        })),
      }),
    ]);
    return this.names(scope);
  }

  /**
   * A rename carries the names' agencies over to the new name (`saveRule`): the new name
   * is taxed by every agency any of the old ones was.
   */
  async carryAgencies(
    scope: BookScope,
    oldNames: readonly string[],
    newName: string,
  ): Promise<void> {
    const keys = new Set(oldNames.map(nameTaxKey));
    if (!keys.size) return;
    const rows = await this.prisma.ledgerNameAgency.findMany({
      where: scopeWhere(scope),
      select: { name: true, agencyId: true },
    });
    const target = nameTaxKey(newName);
    const have = new Set(
      rows.filter((r) => nameTaxKey(r.name) === target).map((r) => r.agencyId),
    );
    const add = [
      ...new Set(
        rows
          .filter((r) => keys.has(nameTaxKey(r.name)) && !have.has(r.agencyId))
          .map((r) => r.agencyId),
      ),
    ];
    if (!add.length) return;
    await this.prisma.ledgerNameAgency.createMany({
      data: add.map((agencyId) => ({
        ...scopeWhere(scope),
        name: newName,
        agencyId,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Renames one tax line — the agency's tax on one transaction (or split). Null puts the
   * transaction's own name back. False when the row has no such line. The name is kept in
   * `TransactionTax` (with a snapshot of the line), keyed by row and agency.
   */
  async renameLine(
    scope: BookScope,
    transactionId: number,
    agencyId: number,
    name: string | null,
  ): Promise<boolean> {
    const lines = await this.compute(scope, {
      OR: [{ id: transactionId }, { splitOfId: transactionId }],
    });
    const line = lines.get(transactionId)?.find((l) => l.agencyId === agencyId);
    if (!line) return false;
    await this.prisma.transactionTax.upsert({
      where: { transactionId_agencyId: { transactionId, agencyId } },
      create: {
        ...scopeWhere(scope),
        transactionId,
        agencyId,
        kind: line.kind,
        rate: line.rate.toFixed(3),
        amount: line.amount.toFixed(2),
        name,
      },
      update: { name },
    });
    return true;
  }
}

/** Descriptions listed per name on the Names tab. */
const MAX_DESCRIPTIONS = 25;

/**
 * Per lower-cased name: its rows grouped by description key, each with one printed
 * description and the category those rows mostly have, most rows first.
 */
function groupDescriptions(
  rows: ReadonlyArray<{
    name: string | null;
    description: string;
    offsetAccount: string;
  }>,
): Map<string, Array<{ description: string; category: string; rows: number }>> {
  const byName = new Map<
    string,
    Map<string, { description: string; categories: Map<string, number> }>
  >();
  for (const r of rows) {
    if (!r.name) continue;
    const name = r.name.toLowerCase();
    const key =
      descriptionKey(r.description) || r.description.trim().toLowerCase();
    const groups: Map<
      string,
      { description: string; categories: Map<string, number> }
    > =
      byName.get(name) ??
      new Map<
        string,
        { description: string; categories: Map<string, number> }
      >();
    const g = groups.get(key) ?? {
      description: r.description,
      categories: new Map<string, number>(),
    };
    g.categories.set(
      r.offsetAccount,
      (g.categories.get(r.offsetAccount) ?? 0) + 1,
    );
    groups.set(key, g);
    byName.set(name, groups);
  }
  const out = new Map<
    string,
    Array<{ description: string; category: string; rows: number }>
  >();
  for (const [name, groups] of byName) {
    out.set(
      name,
      [...groups.values()]
        .map((g) => {
          const sorted = [...g.categories.entries()].sort(
            (a, b) => b[1] - a[1],
          );
          return {
            description: g.description,
            category: sorted[0][0],
            rows: sorted.reduce((n, [, c]) => n + c, 0),
          };
        })
        .sort(
          (a, b) =>
            b.rows - a.rows || a.description.localeCompare(b.description),
        )
        .slice(0, MAX_DESCRIPTIONS),
    );
  }
  return out;
}
