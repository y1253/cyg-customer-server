import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatementStatus,
  type TaxAgency,
  type TaxAgencyRate,
} from '@prisma/client';
import { toE164 } from '../customer-auth/phone-number.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCOUNT_NAMES,
  typeFor,
  UNCATEGORIZED,
  type TypeContext,
} from './chart-of-accounts';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  descriptionContains,
  descriptionKey,
  nameKey,
  type RuleMatchType,
} from './name-memory.util';
import { UNCLARIFIED_NAME } from './reports.util';
import { scopeWhere, type BookScope } from './scope';
import { remainderOf, splitTotals } from './splits.util';
import {
  NAME_FIELD_KINDS,
  type AgencyRateDto,
  type CreateAgencyDto,
  type NameFieldDto,
  type NameFieldKind,
  type UpdateAgencyDto,
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
  /** What its rows add up to, as the bank moved it (tax included; a split parent counts what is left). */
  total: number;
  /** The tax agencies that tax this name's rows (none = not taxed, the default). */
  agencyIds: number[];
  /**
   * The descriptions the AI put under this name (one per description key, most rows first,
   * at most `MAX_DESCRIPTIONS`), with the category their rows mostly have — and (step9) the
   * customer's rule that ties it to this name, and its exceptions.
   */
  descriptions: NameDescriptionView[];
  /** step9: the customer's "description contains …" rules that give rows this name. */
  followsContains: Array<{
    key: string;
    text: string;
    category: string | null;
    rows: number;
  }>;
  /**
   * step9: this name's rows that are one-time EXCEPTIONS from another name (the name their
   * description's rules give, `ruleName`) — "exception from Walmart".
   */
  exceptionOf: Array<{
    main: string;
    key: string;
    description: string;
    rows: number;
  }>;
  /**
   * step9: its Names-tab group — `LedgerName.group` (CUSTOMER | SUPPLIER | OTHER | g<id>), else
   * its `type`. A label only.
   */
  group: string;
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
  /** step2 (2026-11-09): the customer's own profile fields for this name (phone, email, …). */
  fields: NameField[];
}

/** step2 (2026-11-09): one field of a name's profile — `LedgerName.fields`. */
export interface NameField {
  kind: NameFieldKind;
  label: string;
  value: string;
}

/** The stored JSON, read defensively (a hand-edited row never breaks the Names tab). */
export function parseNameFields(raw: unknown): NameField[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f: unknown) => {
    const o = f as Partial<NameField> | null;
    if (!o || typeof o.value !== 'string' || !o.value) return [];
    const kind = (NAME_FIELD_KINDS as readonly string[]).includes(o.kind ?? '')
      ? o.kind!
      : 'TEXT';
    return [{ kind, label: typeof o.label === 'string' ? o.label : '', value: o.value }];
  });
}

/** step9: one description under a name on the Names tab. */
export interface NameDescriptionView {
  /** Its description key — what a DESCRIPTION rule (an Assign, a drag) saves under. */
  key: string;
  /** One of its descriptions, as printed. */
  description: string;
  category: string;
  rows: number;
  /**
   * The customer's rule that gives these rows this name (`personalRuleId`): an exact
   * DESCRIPTION rule or a CONTAINS rule. Null = the AI / firm memory named them.
   */
  rule: {
    id: number;
    matchType: 'DESCRIPTION' | 'CONTAINS';
    matchKey: string;
    text: string;
  } | null;
  /**
   * Rows of this description the customer renamed ONE time — they are exceptions from this
   * name, listed under the names they carry now.
   */
  exceptions: Array<{ name: string; rows: number }>;
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
  /** What its rows add up to (see `NameView.total`). */
  total: number;
  rule: { matchType: RuleMatchType; matchKey: string } | null;
}

/** A customer's "description contains …" rule (step2), on the Names tab. */
export interface ContainsRuleView {
  /** The text, as typed. */
  text: string;
  /** What it is stored under (`matchKey`) — what an edit or a reset sends. */
  key: string;
  name: string | null;
  category: string | null;
  /** Ledger rows whose description contains it now. */
  rows: number;
}

export interface NamesView {
  names: NameView[];
  unrecognized: UnrecognizedView[];
  /** step9: only the CONTAINS rules with NO name (category only) — the others sit in their name. */
  containsRules: ContainsRuleView[];
  /** step9: the Names-tab groups — the built-in three, then the customer's own. */
  groups: NameGroupView[];
}

/** step9: a Names-tab group. `key` is what `LedgerName.group` stores. */
export interface NameGroupView {
  key: string;
  label: string;
  /** Made by the customer (renamable, removable). */
  id?: number;
}

/** step9: the built-in groups, in Names-tab order. */
export const BUILTIN_GROUPS: NameGroupView[] = [
  { key: 'SUPPLIER', label: 'Suppliers' },
  { key: 'CUSTOMER', label: 'Customers' },
  { key: 'OTHER', label: 'Other' },
];

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
        select: {
          ...TOTAL_SELECT,
          ...PROVENANCE_SELECT,
          name: true,
          description: true,
          offsetAccount: true,
        },
      }),
      this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), name: null, statement: DONE },
        select: {
          ...TOTAL_SELECT,
          ...PROVENANCE_SELECT,
          description: true,
          offsetAccount: true,
        },
      }),
      this.prisma.ledgerNameAgency.findMany({
        where: { ...scopeWhere(scope), agency: { deletedAt: null } },
        select: { name: true, agencyId: true },
        orderBy: { agencyId: 'asc' },
      }),
      this.prisma.customerNameRule.findMany({
        where: scopeWhere(scope),
        select: {
          id: true,
          matchType: true,
          matchKey: true,
          name: true,
          category: true,
          includeChars: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.typeContext(scope),
    ]);
    const [placed, ownGroups] = await Promise.all([
      this.prisma.ledgerName.findMany({
        where: {
          ...scopeWhere(scope),
          OR: [{ group: { not: null } }, { fields: { not: Prisma.DbNull } }],
        },
        select: { name: true, group: true, fields: true },
      }),
      this.prisma.customerNameGroup.findMany({
        where: { ...scopeWhere(scope), deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);
    const groupList: NameGroupView[] = [
      ...BUILTIN_GROUPS,
      ...ownGroups.map((g) => ({ key: `g${g.id}`, label: g.name, id: g.id })),
    ];
    const validGroups = new Set(groupList.map((g) => g.key));
    const groupOf = new Map(
      placed
        .filter((l) => l.group && validGroups.has(l.group))
        .map((l) => [nameKey(l.name), l.group!]),
    );
    const fieldsOf = new Map(
      placed.map((l) => [nameKey(l.name), parseNameFields(l.fields)]),
    );
    const rulesById = new Map(rules.map((r) => [r.id, r]));
    const { descriptionsOf, exceptionOf } = groupDescriptions(
      [...named, ...nameless],
      rulesById,
    );
    const shareOf = rowShares([...named, ...nameless]);
    const totalOf = new Map<string, number>();
    for (const r of named) {
      const key = r.name!.toLowerCase();
      totalOf.set(key, (totalOf.get(key) ?? 0) + shareOf(r));
    }
    const agenciesOf = new Map<string, number[]>();
    for (const p of picks) {
      const key = nameTaxKey(p.name);
      agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
    }

    const ref = (r: { matchType: string; matchKey: string }) => ({
      matchType: (r.matchType === 'DESCRIPTION' || r.matchType === 'CONTAINS'
        ? r.matchType
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
          (r.matchType === 'DESCRIPTION' || r.matchType === 'CONTAINS') &&
          r.name &&
          nameKey(r.name) === key,
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
          total: (totalOf.get(key) ?? 0) / 100,
          agencyIds: agenciesOf.get(nameTaxKey(name)) ?? [],
          fields: fieldsOf.get(key) ?? [],
          descriptions: descriptionsOf.get(key) ?? [],
          followsContains: rules
            .filter(
              (r) =>
                r.matchType === 'CONTAINS' && r.name && nameKey(r.name) === key,
            )
            .map((r) => ({
              key: r.matchKey,
              text: r.includeChars ?? r.matchKey,
              category: r.category,
              rows: [...named, ...nameless].filter(
                (t) =>
                  !t.splitOfId &&
                  descriptionContains(t.description, r.matchKey),
              ).length,
            })),
          exceptionOf: exceptionOf.get(key) ?? [],
          group: groupOf.get(key) ?? typeOfCategory(category, ctx),
          ruleKey: rule?.matchType === 'NAME' ? rule.matchKey : key,
          rule,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const byKey = new Map<
      string,
      { sample: string; categories: Map<string, number>; cents: number }
    >();
    for (const t of nameless) {
      const key = descriptionKey(t.description);
      if (!key) continue;
      const entry = byKey.get(key) ?? {
        sample: t.description,
        categories: new Map<string, number>(),
        cents: 0,
      };
      entry.cents += shareOf(t);
      entry.categories.set(
        t.offsetAccount,
        (entry.categories.get(t.offsetAccount) ?? 0) + 1,
      );
      byKey.set(key, entry);
    }
    const unrecognized = [...byKey.entries()]
      .map(([key, { sample, categories, cents }]): UnrecognizedView => {
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
          total: cents / 100,
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
        total: nameless.reduce((n, r) => n + shareOf(r), 0) / 100,
        agencyIds: agenciesOf.get(nameTaxKey(null)) ?? [],
        fields: [],
        descriptions: unrecognized.slice(0, MAX_DESCRIPTIONS).map((u) => ({
          key: u.key,
          description: u.sampleDescription,
          category: u.category,
          rows: u.rows,
          rule: null,
          exceptions:
            descriptionsOf
              .get(nameKey(UNCLARIFIED_NAME))
              ?.find((d) => d.key === u.key)?.exceptions ?? [],
        })),
        followsContains: [],
        exceptionOf: exceptionOf.get(nameKey(UNCLARIFIED_NAME)) ?? [],
        group: 'OTHER',
        ruleKey: '',
        rule: null,
        unclarified: true,
      });
      names.sort((a, b) => a.name.localeCompare(b.name));
    }

    const descriptions = [...named, ...nameless].filter((r) => !r.splitOfId);
    // A CONTAINS rule that names its rows lives in that name (`followsContains`); only the
    // category-only ones are listed on their own.
    const containsRules = rules
      .filter((r) => r.matchType === 'CONTAINS' && !r.name)
      .map(
        (r): ContainsRuleView => ({
          text: r.includeChars ?? r.matchKey,
          key: r.matchKey,
          name: r.name,
          category: r.category,
          rows: descriptions.filter((t) =>
            descriptionContains(t.description, r.matchKey),
          ).length,
        }),
      );

    return { names, unrecognized, containsRules, groups: groupList };
  }

  /**
   * step9: put a name in a Names-tab group — a label only (its accounts and tax stay).
   * `group` null = follow its category again. One `LedgerName` row per name and book.
   */
  async setNameGroup(
    scope: BookScope,
    rawName: string,
    group: string | null,
  ): Promise<void> {
    const name = rawName.trim();
    if (!name || nameKey(name) === nameKey(UNCLARIFIED_NAME))
      throw new BadRequestException('Pick a name');
    if (group && /^g\d+$/.test(group)) {
      const own = await this.prisma.customerNameGroup.findFirst({
        where: {
          id: Number(group.slice(1)),
          ...scopeWhere(scope),
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!own) throw new BadRequestException('That group no longer exists');
    }
    const existing = await this.prisma.ledgerName.findFirst({
      where: { ...scopeWhere(scope), name },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.ledgerName.update({
        where: { id: existing.id },
        data: { group },
      });
    } else if (group) {
      await this.prisma.ledgerName.create({
        data: { ...scopeWhere(scope), name, group },
      });
    }
  }

  /**
   * step2 (2026-11-09): a name's profile — the whole list ([] clears it). A phone is stored
   * in E.164 (400 when it is not one), an email lower-cased; empty values are dropped.
   * The customer's reference only: the AI's contacts (`AiContact`) are separate.
   */
  async setNameFields(
    scope: BookScope,
    rawName: string,
    input: NameFieldDto[],
  ): Promise<void> {
    const name = rawName.trim();
    if (!name || nameKey(name) === nameKey(UNCLARIFIED_NAME))
      throw new BadRequestException('Pick a name');
    const fields = input.flatMap((f): NameField[] => {
      const value = f.value.trim();
      if (!value) return [];
      if (f.kind === 'PHONE') {
        const e164 = toE164(value);
        if (!e164)
          throw new BadRequestException(
            `“${value}” is not a phone number (add the country code if outside Canada / the US)`,
          );
        return [{ kind: f.kind, label: f.label.trim(), value: e164 }];
      }
      if (f.kind === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new BadRequestException(`“${value}” is not an email address`);
      return [
        {
          kind: f.kind,
          label: f.label.trim(),
          value: f.kind === 'EMAIL' ? value.toLowerCase() : value,
        },
      ];
    });
    const data = fields.length
      ? (fields as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;
    const existing = await this.prisma.ledgerName.findFirst({
      where: { ...scopeWhere(scope), name },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.ledgerName.update({
        where: { id: existing.id },
        data: { fields: data },
      });
    } else if (fields.length) {
      await this.prisma.ledgerName.create({
        data: { ...scopeWhere(scope), name, fields: data },
      });
    }
  }

  /**
   * step2 (2026-11-09): a merged name's profile fields join the target's (a field the
   * target already has, same kind and value, is not repeated). Before the source row goes.
   */
  async mergeNameFields(
    scope: BookScope,
    source: string,
    target: string,
  ): Promise<void> {
    const rows = await this.prisma.ledgerName.findMany({
      where: { ...scopeWhere(scope), name: { in: [source, target] } },
      select: { id: true, name: true, fields: true },
    });
    const from = rows.find((r) => nameKey(r.name) === nameKey(source));
    const extra = parseNameFields(from?.fields);
    if (!extra.length) return;
    const into = rows.find((r) => nameKey(r.name) === nameKey(target));
    const own = parseNameFields(into?.fields);
    const seen = new Set(own.map((f) => `${f.kind}|${f.value.toLowerCase()}`));
    const fields = [
      ...own,
      ...extra.filter((f) => !seen.has(`${f.kind}|${f.value.toLowerCase()}`)),
    ] as unknown as Prisma.InputJsonValue;
    if (into)
      await this.prisma.ledgerName.update({
        where: { id: into.id },
        data: { fields },
      });
    else
      await this.prisma.ledgerName.create({
        data: { ...scopeWhere(scope), name: target, fields },
      });
  }

  /** step9: a new Names-tab group of the customer's own ("Employees"). */
  async createNameGroup(
    scope: BookScope,
    rawName: string,
  ): Promise<NameGroupView> {
    const name = rawName.trim().slice(0, 64);
    const groups = await this.prisma.customerNameGroup.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      select: { name: true, sortOrder: true },
    });
    const taken = [
      ...BUILTIN_GROUPS.map((g) => g.label),
      ...groups.map((g) => g.name),
    ];
    if (taken.some((t) => t.toLowerCase() === name.toLowerCase()))
      throw new BadRequestException(`You already have a group "${name}"`);
    const row = await this.prisma.customerNameGroup.create({
      data: {
        ...scopeWhere(scope),
        name,
        sortOrder: groups.reduce((n, g) => Math.max(n, g.sortOrder + 1), 0),
      },
    });
    return { key: `g${row.id}`, label: row.name, id: row.id };
  }

  async renameNameGroup(
    scope: BookScope,
    id: number,
    rawName: string,
  ): Promise<void> {
    const found = await this.prisma.customerNameGroup.updateMany({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      data: { name: rawName.trim().slice(0, 64) },
    });
    if (!found.count) throw new NotFoundException('Group not found');
  }

  /** Removing a group sends its names back to following their category. */
  async deleteNameGroup(scope: BookScope, id: number): Promise<void> {
    const found = await this.prisma.customerNameGroup.updateMany({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!found.count) throw new NotFoundException('Group not found');
    await this.prisma.ledgerName.updateMany({
      where: { ...scopeWhere(scope), group: `g${id}` },
      data: { group: null },
    });
  }

  /**
   * step9: the Names-tab search by bank description — every name whose rows' descriptions
   * contain `q` (case-insensitive), with the matching descriptions (one per key).
   */
  async searchDescriptions(
    scope: BookScope,
    q: string,
  ): Promise<Array<{ name: string; key: string; description: string }>> {
    const text = q.trim();
    if (text.length < 2) return [];
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        ...scopeWhere(scope),
        statement: DONE,
        splitOfId: null,
        description: { contains: text },
      },
      select: { name: true, description: true },
      take: 2000,
    });
    const seen = new Map<
      string,
      { name: string; key: string; description: string }
    >();
    for (const r of rows) {
      const name = r.name ?? UNCLARIFIED_NAME;
      const key =
        descriptionKey(r.description) || r.description.trim().toLowerCase();
      const k = `${nameKey(name)}|${key}`;
      if (!seen.has(k)) seen.set(k, { name, key, description: r.description });
    }
    return [...seen.values()].slice(0, 300);
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
   * step2 (2026-11-08): a renamed payee keeps its Names-tab settings (`LedgerName`: group,
   * "Tax applies") — unless the new name already has its own.
   */
  async carryNameSettings(
    scope: BookScope,
    oldNames: readonly string[],
    newName: string,
  ): Promise<void> {
    const keys = new Set(oldNames.map(nameTaxKey));
    const target = nameTaxKey(newName);
    keys.delete(target);
    if (!keys.size) return;
    const rows = await this.prisma.ledgerName.findMany({
      where: scopeWhere(scope),
      select: { name: true, group: true, taxExempt: true, fields: true },
    });
    if (rows.some((r) => nameTaxKey(r.name) === target)) return;
    const from = rows.find((r) => keys.has(nameTaxKey(r.name)));
    if (!from) return;
    await this.prisma.ledgerName.create({
      data: {
        ...scopeWhere(scope),
        name: newName,
        group: from.group,
        taxExempt: from.taxExempt,
        fields: (from.fields as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
      },
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
const TOTAL_SELECT = { id: true, amount: true, splitOfId: true } as const;
/** step9: where a row's name came from — for a description's rule and its exceptions. */
const PROVENANCE_SELECT = {
  personalRuleId: true,
  exceptionRuleId: true,
  ruleName: true,
} as const;

/**
 * Each row's own share of the money, in cents: a split its amount, a parent what its splits
 * leave of the bank amount (`remainderOf`) — so a name's total never counts a split twice.
 */
function rowShares(
  rows: ReadonlyArray<{
    id: number;
    amount: Prisma.Decimal | number;
    splitOfId: number | null;
  }>,
): (row: {
  id: number;
  amount: Prisma.Decimal | number;
  splitOfId: number | null;
}) => number {
  const cents = (a: Prisma.Decimal | number) => Math.round(Number(a) * 100);
  const splitCents = new Map<number, number>();
  for (const r of rows) {
    if (r.splitOfId === null) continue;
    splitCents.set(
      r.splitOfId,
      (splitCents.get(r.splitOfId) ?? 0) + cents(r.amount),
    );
  }
  return (r) =>
    r.splitOfId !== null
      ? cents(r.amount)
      : cents(r.amount) - (splitCents.get(r.id) ?? 0);
}

function groupDescriptions(
  rows: ReadonlyArray<{
    name?: string | null;
    description: string;
    offsetAccount: string;
    personalRuleId: number | null;
    exceptionRuleId: number | null;
    ruleName: string | null;
  }>,
  rulesById: ReadonlyMap<
    number,
    { matchType: string; matchKey: string; includeChars: string | null }
  >,
): {
  descriptionsOf: Map<string, NameDescriptionView[]>;
  exceptionOf: Map<string, NameView['exceptionOf']>;
} {
  type Group = {
    description: string;
    categories: Map<string, number>;
    rules: Map<number, number>;
    exceptions: Map<string, { name: string; rows: number }>;
    rows: number;
  };
  const byName = new Map<string, Map<string, Group>>();
  const groupFor = (name: string, key: string, description: string) => {
    const groups = byName.get(name) ?? new Map<string, Group>();
    byName.set(name, groups);
    const g = groups.get(key) ?? {
      description,
      categories: new Map<string, number>(),
      rules: new Map<number, number>(),
      exceptions: new Map<string, { name: string; rows: number }>(),
      rows: 0,
    };
    groups.set(key, g);
    return g;
  };
  const exceptionOf = new Map<
    string,
    Map<string, NameView['exceptionOf'][number]>
  >();
  for (const r of rows) {
    const own = r.name ?? UNCLARIFIED_NAME;
    const name = own.toLowerCase();
    const key =
      descriptionKey(r.description) || r.description.trim().toLowerCase();
    const g = groupFor(name, key, r.description);
    g.rows++;
    g.categories.set(
      r.offsetAccount,
      (g.categories.get(r.offsetAccount) ?? 0) + 1,
    );
    if (r.personalRuleId !== null)
      g.rules.set(r.personalRuleId, (g.rules.get(r.personalRuleId) ?? 0) + 1);
    // An exception: the rules give it another name (`ruleName`) — counted under THAT name.
    const main = r.exceptionRuleId !== null ? r.ruleName : null;
    if (main && main.toLowerCase() !== name) {
      const m = groupFor(main.toLowerCase(), key, r.description);
      const e = m.exceptions.get(name) ?? { name: own, rows: 0 };
      e.rows++;
      m.exceptions.set(name, e);
      const mine =
        exceptionOf.get(name) ??
        new Map<string, NameView['exceptionOf'][number]>();
      const x = mine.get(`${main.toLowerCase()}|${key}`) ?? {
        main,
        key,
        description: r.description,
        rows: 0,
      };
      x.rows++;
      mine.set(`${main.toLowerCase()}|${key}`, x);
      exceptionOf.set(name, mine);
    }
  }
  const descriptionsOf = new Map<string, NameDescriptionView[]>();
  for (const [name, groups] of byName) {
    descriptionsOf.set(
      name,
      [...groups.entries()]
        .map(([key, g]): NameDescriptionView => {
          const sorted = [...g.categories.entries()].sort(
            (a, b) => b[1] - a[1],
          );
          const ruleId = [...g.rules.entries()].sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0];
          const rule = ruleId === undefined ? undefined : rulesById.get(ruleId);
          return {
            key,
            description: g.description,
            category: sorted[0]?.[0] ?? UNCATEGORIZED,
            rows: g.rows,
            rule:
              rule &&
              ruleId !== undefined &&
              (rule.matchType === 'DESCRIPTION' ||
                rule.matchType === 'CONTAINS')
                ? {
                    id: ruleId,
                    matchType: rule.matchType,
                    matchKey: rule.matchKey,
                    text: rule.includeChars ?? rule.matchKey,
                  }
                : null,
            exceptions: [...g.exceptions.values()].sort(
              (a, b) => b.rows - a.rows,
            ),
          };
        })
        .sort(
          (a, b) =>
            b.rows - a.rows ||
            b.exceptions.length - a.exceptions.length ||
            a.description.localeCompare(b.description),
        )
        .slice(0, MAX_DESCRIPTIONS),
    );
  }
  return {
    descriptionsOf,
    exceptionOf: new Map(
      [...exceptionOf.entries()].map(([k, v]) => [k, [...v.values()]]),
    ),
  };
}
