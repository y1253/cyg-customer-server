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
  exceptionOwner,
  nameKey,
  type RuleMatchType,
} from './name-memory.util';
import {
  attachmentName,
  nameKeyOf,
  type NameInput,
} from './attachment-name.util';
import { UNCLARIFIED_NAME } from './reports.util';
import { moveNameAnswers } from './custom-column-defaults';
import { scopeWhere, type BookScope } from './scope';
import { SplitRulesService } from './split-rules.service';
import { refuseWrapper } from './sub-name-parents';
import { splitLabelOf, splitSubNameOf, subNameOf } from './sub-names.util';
import {
  NAME_FIELD_KINDS,
  type AgencyRateDto,
  type CreateAgencyDto,
  type NameFieldDto,
  type NameFieldKind,
  type SplitGroupDto,
  type UpdateSplitGroupDto,
  type UpdateAgencyDto,
} from './dto/agency.dto';
import { nameTaxKey, type TaxKind } from './tax.util';

/** step9 part 4 (2026-11-15): a split rule (was a tax agency). */
export interface AgencyView {
  id: number;
  name: string;
  /** At most one per kind (SALES = In, PURCHASE = Out), In first. */
  rates: Array<{
    kind: TaxKind;
    mode: 'PERCENT' | 'FIXED';
    rate: number;
    amount: number | null;
  }>;
  /** Where its splits post; null = its own name. */
  category: string | null;
  /** step9 (2026-11-18): whether it splits — for a rule in a group, its GROUP's switch. */
  active: boolean;
  /** step9 (2026-11-17): its split group; null = an individual rule. */
  groupId: number | null;
}

/** step9 (2026-11-17): a split group — its rules run together on the same amount. */
export interface SplitGroupView {
  id: number;
  name: string;
  /** step9 (2026-11-18): its rules' on / off switch. */
  active: boolean;
  /** Its live rules, oldest first. */
  agencyIds: number[];
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
  /** The split rules picked for this name (none = the default). */
  agencyIds: number[];
  /**
   * step9 (2026-11-19): its pick is ONE rule of a split group taken on its own (it cuts like
   * an individual rule); false = an individual rule or a whole group.
   */
  agencyAlone: boolean;
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
    /** step12 (2026-11-20): a split named apart from its transaction. */
    split?: true;
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
    return [
      {
        kind,
        label: typeof o.label === 'string' ? o.label : '',
        value: o.value,
      },
    ];
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
    /** step9 (2026-11-17): the sub-name its rows are filed under (a rule saved from a split). */
    subName?: string;
  } | null;
  /**
   * Rows of this description the customer renamed ONE time — they are exceptions from this
   * name, listed under the names they carry now.
   */
  exceptions: Array<{
    name: string;
    rows: number;
    /** step12 (2026-11-20): only the category was changed for these rows — this one. */
    category?: string;
    /** step12 (2026-11-20): splits named apart from their transaction. */
    split?: true;
  }>;
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
  /**
   * step9 (2026-11-17, second request): each sub-name's descriptions (by sub-name id) — a
   * name with sub-names is only a wrapper, its sub-names hold its descriptions.
   */
  subDescriptions: Record<number, NameDescriptionView[]>;
  /**
   * step9 (2026-11-17, third request): each sub-name's "description contains" rules (by
   * sub-name id) — like a name's `followsContains`.
   */
  subContains: Record<number, NameView['followsContains']>;
  /** step12 (2026-11-20): each sub-name's rows that are exceptions from another name / sub-name. */
  subExceptionOf: Record<number, NameView['exceptionOf']>;
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

export interface TaxSettingsView {
  agencies: AgencyView[];
  groups: SplitGroupView[];
}

const KIND_ORDER: TaxKind[] = ['SALES', 'PURCHASE'];

const toAgency = (
  a: TaxAgency & {
    rates: TaxAgencyRate[];
    group?: { active: boolean } | null;
  },
): AgencyView => ({
  id: a.id,
  name: a.name,
  rates: KIND_ORDER.flatMap((kind) => {
    const r = a.rates.find((x) => x.kind === kind);
    return r
      ? [
          {
            kind,
            mode: r.mode,
            rate: Number(r.rate),
            amount: r.amount === null ? null : Number(r.amount),
          },
        ]
      : [];
  }),
  category: a.category,
  active: a.groupId !== null && a.group ? a.group.active : a.active,
  groupId: a.groupId,
});

/** With its group's switch (`toAgency`). */
const AGENCY_INCLUDE = {
  rates: true,
  group: { select: { active: true } },
} as const;

/** The rates as stored; one direction given twice, or a rate without its number, is refused. */
function rateRows(rates: AgencyRateDto[]) {
  if (new Set(rates.map((r) => r.kind)).size !== rates.length) {
    throw new BadRequestException('Give In and Out only one rate each');
  }
  return rates.map((r) => {
    const mode = r.mode ?? 'PERCENT';
    if (mode === 'FIXED') {
      if (r.amount === undefined || r.amount <= 0)
        throw new BadRequestException('Give the fixed amount');
      return { kind: r.kind, mode, rate: '0.000', amount: r.amount.toFixed(2) };
    }
    if (r.rate === undefined)
      throw new BadRequestException('Give the percentage');
    return { kind: r.kind, mode, rate: r.rate.toFixed(3), amount: null };
  });
}

const typeOfCategory = (category: string, ctx: TypeContext): NameType => {
  const type = typeFor(category, ctx);
  if (type === 'INCOME') return 'CUSTOMER';
  if (type === 'EXPENSE') return 'SUPPLIER';
  return 'OTHER';
};

const DONE = { deletedAt: null, status: StatementStatus.DONE };

/**
 * Split rules (step9 part 4, 2026-11-15 — were "tax agencies") and which NAMES each one is
 * picked for (`LedgerNameAgency`), plus the Names tab. A pick splits the name's rows once
 * (`SplitRulesService`): the splits are regular splits afterwards. Until step9 part 4 the
 * agencies taxed the rows on READ; those lines were converted to splits once.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
    private readonly splitRules: SplitRulesService,
  ) {}

  // ---- split rules (the `TaxAgency` rows) ----

  async settings(scope: BookScope): Promise<TaxSettingsView> {
    const agencies = await this.prisma.taxAgency.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      include: AGENCY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const groups = await this.prisma.splitGroup.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return {
      agencies: agencies.map(toAgency),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        active: g.active,
        agencyIds: agencies.filter((a) => a.groupId === g.id).map((a) => a.id),
      })),
    };
  }

  async createAgency(
    scope: BookScope,
    dto: CreateAgencyDto,
  ): Promise<AgencyView> {
    const name = await this.checkName(scope, dto.name);
    const category = await this.ruleCategory(scope, dto.category, name);
    const groupId = await this.checkGroupId(scope, dto.groupId);
    const row = await this.prisma.taxAgency.create({
      data: {
        ...scopeWhere(scope),
        name,
        category: category ?? null,
        active: dto.active ?? true,
        groupId: groupId ?? null,
        rates: { create: rateRows(dto.rates) },
      },
      include: AGENCY_INCLUDE,
    });
    if (row.groupId !== null)
      await this.joinGroupPicks(scope, row.id, row.groupId);
    return toAgency(row);
  }

  async updateAgency(
    scope: BookScope,
    id: number,
    dto: UpdateAgencyDto,
  ): Promise<AgencyView> {
    const current = await this.ownedAgency(scope, id);
    const name =
      dto.name === undefined
        ? undefined
        : await this.checkName(scope, dto.name, id);
    const category = await this.ruleCategory(
      scope,
      dto.category,
      name ?? current.name,
    );
    const rates = dto.rates && rateRows(dto.rates);
    const groupId = await this.checkGroupId(scope, dto.groupId);
    // step9 (2026-11-18): a rule in a group has no switch of its own (its group's rules);
    // one that leaves its group keeps the group's state, so nothing turns on or off by itself.
    const nextGroup = groupId === undefined ? current.groupId : groupId;
    let active = nextGroup === null ? dto.active : undefined;
    if (current.groupId !== null && nextGroup !== current.groupId)
      active =
        nextGroup === null && dto.active !== undefined
          ? dto.active
          : (
              await this.prisma.splitGroup.findUnique({
                where: { id: current.groupId },
                select: { active: true },
              })
            )?.active;
    // A change applies to rows split from now on; the splits already written stay.
    const row = await this.prisma.taxAgency.update({
      where: { id },
      data: {
        name,
        category,
        active,
        groupId,
        // Replaces every rate: deleteMany then create, in the same update.
        ...(rates && { rates: { deleteMany: {}, create: rates } }),
      },
      include: AGENCY_INCLUDE,
    });
    // step9 (2026-11-19): a rule that leaves its group is individual — "alone" means nothing.
    if (current.groupId !== null && row.groupId !== current.groupId)
      await this.prisma.ledgerNameAgency.updateMany({
        where: { ...scopeWhere(scope), agencyId: row.id, alone: true },
        data: { alone: false },
      });
    if (row.groupId !== null && row.groupId !== current.groupId)
      await this.joinGroupPicks(scope, row.id, row.groupId);
    return toAgency(row);
  }

  /**
   * A rule's category: undefined = unchanged, ''/null = its own name, else a chart / own
   * category (never its own name — that is the default).
   */
  private async ruleCategory(
    scope: BookScope,
    raw: string | null | undefined,
    name: string,
  ): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    const clean = raw?.trim();
    if (!clean || clean.toLowerCase() === name.toLowerCase()) return null;
    return this.accounts.validCategory(scope, clean);
  }

  /** Soft delete; the names it was picked for lose it (the splits it made stay). */
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

  // ---- step9 (2026-11-17): split groups ----

  async createGroup(
    scope: BookScope,
    dto: SplitGroupDto,
  ): Promise<SplitGroupView> {
    const name = await this.checkGroupName(scope, dto.name);
    const row = await this.prisma.splitGroup.create({
      data: { ...scopeWhere(scope), name, active: dto.active ?? true },
    });
    return { id: row.id, name: row.name, active: row.active, agencyIds: [] };
  }

  /** Rename it and / or (step9 2026-11-18) switch all its rules on or off. */
  async updateGroup(
    scope: BookScope,
    id: number,
    dto: UpdateSplitGroupDto,
  ): Promise<SplitGroupView> {
    await this.ownedGroup(scope, id);
    const name =
      dto.name === undefined
        ? undefined
        : await this.checkGroupName(scope, dto.name, id);
    const row = await this.prisma.splitGroup.update({
      where: { id },
      data: { name, active: dto.active },
    });
    const members = await this.prisma.taxAgency.findMany({
      where: { ...scopeWhere(scope), deletedAt: null, groupId: id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id,
      name: row.name,
      active: row.active,
      agencyIds: members.map((m) => m.id),
    };
  }

  /**
   * Soft delete (user's decision): its rules become individual rules, and the names that
   * picked the group keep them. The splits already written stay. step9 (2026-11-18): they
   * keep the group's on / off state.
   */
  async removeGroup(scope: BookScope, id: number): Promise<void> {
    const group = await this.ownedGroup(scope, id);
    await this.prisma.$transaction([
      this.prisma.ledgerNameAgency.updateMany({
        where: { ...scopeWhere(scope), alone: true, agency: { groupId: id } },
        data: { alone: false },
      }),
      this.prisma.taxAgency.updateMany({
        where: { ...scopeWhere(scope), groupId: id },
        data: { groupId: null, active: group.active },
      }),
      this.prisma.splitGroup.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ]);
  }

  private async ownedGroup(scope: BookScope, id: number) {
    const g = await this.prisma.splitGroup.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!g) throw new NotFoundException('Split group not found');
    return g;
  }

  /** undefined = unchanged, null = individual, else a live group of the book. */
  private async checkGroupId(
    scope: BookScope,
    groupId: number | null | undefined,
  ): Promise<number | null | undefined> {
    if (groupId === undefined || groupId === null) return groupId;
    await this.ownedGroup(scope, groupId);
    return groupId;
  }

  private async checkGroupName(
    scope: BookScope,
    raw: string,
    exceptId?: number,
  ): Promise<string> {
    const name = raw.trim();
    if (!name) throw new BadRequestException('Give the group a name');
    const others = await this.prisma.splitGroup.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        NOT: { id: exceptId ?? 0 },
      },
      select: { name: true },
    });
    if (others.some((o) => o.name.toLowerCase() === name.toLowerCase()))
      throw new BadRequestException(`You already have a split group "${name}"`);
    return name;
  }

  /**
   * A rule just joined `groupId`: every name / sub-name that picks the group (any other
   * member) picks it too — applied from now on (rows already split are not cut again).
   * step9 (2026-11-18, part 3): one pick per name — a name that picked the rule on its own
   * now picks the whole group (its other members are added the same way).
   */
  private async joinGroupPicks(
    scope: BookScope,
    agencyId: number,
    groupId: number,
  ): Promise<void> {
    const members = await this.prisma.taxAgency.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        groupId,
        NOT: { id: agencyId },
      },
      select: { id: true },
    });
    if (!members.length) return;
    // step9 (2026-11-19): a member picked ON ITS OWN does not bring the newcomer.
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: {
        ...scopeWhere(scope),
        agencyId: { in: members.map((m) => m.id) },
        alone: false,
      },
      select: { name: true },
    });
    const own = await this.prisma.ledgerNameAgency.findMany({
      where: { ...scopeWhere(scope), agencyId },
      select: { name: true },
    });
    const have = new Set(own.map((o) => nameTaxKey(o.name)));
    const names = new Map<string, string>();
    for (const p of picks) {
      const k = nameTaxKey(p.name);
      if (!have.has(k) && !names.has(k)) names.set(k, p.name);
    }
    const fill = await this.prisma.ledgerNameAgency.findMany({
      where: {
        ...scopeWhere(scope),
        agencyId: { in: members.map((m) => m.id) },
        name: { in: own.map((o) => o.name) },
      },
      select: { name: true, agencyId: true },
    });
    const hasMember = new Set(
      fill.map((f) => `${nameTaxKey(f.name)}|${f.agencyId}`),
    );
    const data = [
      ...[...names.values()].map((name) => ({ name, agencyId })),
      ...own.flatMap((o) =>
        members
          .filter((m) => !hasMember.has(`${nameTaxKey(o.name)}|${m.id}`))
          .map((m) => ({ name: o.name, agencyId: m.id })),
      ),
    ];
    if (!data.length) return;
    await this.prisma.ledgerNameAgency.createMany({
      data: data.map((d) => ({
        ...scopeWhere(scope),
        ...d,
        appliedAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  private async ownedAgency(scope: BookScope, id: number) {
    const a = await this.prisma.taxAgency.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!a) throw new NotFoundException('Split rule not found');
    return a;
  }

  /** The rule's name can be an account name on the ledger — it must not collide. */
  private async checkName(
    scope: BookScope,
    raw: string,
    exceptId?: number,
  ): Promise<string> {
    const name = raw.trim();
    if (!name) throw new BadRequestException('Give the split rule a name');
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
      throw new BadRequestException(`You already have a split rule "${name}"`);
    }
    return name;
  }

  /**
   * Every rule name (removed ones too: splits may post to them) — LIABILITY accounts in the
   * reports. A rule with its own category posts there, so its name is simply never used.
   */
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
          subNameId: true,
          splitRuleId: true,
        },
      }),
      this.prisma.bankTransaction.findMany({
        where: { ...scopeWhere(scope), name: null, statement: DONE },
        select: {
          ...TOTAL_SELECT,
          ...PROVENANCE_SELECT,
          description: true,
          offsetAccount: true,
          subNameId: true,
        },
      }),
      this.prisma.ledgerNameAgency.findMany({
        where: { ...scopeWhere(scope), agency: { deletedAt: null } },
        select: { name: true, agencyId: true, alone: true },
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
          subNameId: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.typeContext(scope),
    ]);
    const [placed, ownGroups, fileNames] = await Promise.all([
      this.prisma.ledgerName.findMany({
        where: {
          ...scopeWhere(scope),
          OR: [
            { group: { not: null } },
            { fields: { not: Prisma.DbNull } },
            { manual: true },
          ],
        },
        select: { name: true, group: true, fields: true, manual: true },
      }),
      this.prisma.customerNameGroup.findMany({
        where: { ...scopeWhere(scope), deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      }),
      this.namesOfFiles(scope),
    ]);
    // step12 (2026-11-22): every group list A–Z, the built-in ones among the customer's own.
    const groupList: NameGroupView[] = [
      ...BUILTIN_GROUPS,
      ...ownGroups.map((g) => ({ key: `g${g.id}`, label: g.name, id: g.id })),
    ].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, {
        sensitivity: 'base',
        numeric: true,
      }),
    );
    const validGroups = new Set(groupList.map((g) => g.key));
    const groupOf = new Map(
      placed
        .filter((l) => l.group && validGroups.has(l.group))
        .map((l) => [nameKey(l.name), l.group!]),
    );
    const fieldsOf = new Map(
      placed.map((l) => [nameKey(l.name), parseNameFields(l.fields)]),
    );
    // step9 (2026-11-17): a description rule saved from a split names its sub-name.
    const ruleSubIds = rules.flatMap((r) => (r.subNameId ? [r.subNameId] : []));
    const ruleSubs = ruleSubIds.length
      ? await this.prisma.subName.findMany({
          where: { id: { in: ruleSubIds }, bookId: scope.bookId },
          select: { id: true, name: true },
        })
      : [];
    const ruleSubName = new Map(ruleSubs.map((s) => [s.id, s.name]));
    const rulesById = new Map(
      rules.map((r) => [
        r.id,
        {
          ...r,
          subName: r.subNameId ? (ruleSubName.get(r.subNameId) ?? null) : null,
        },
      ]),
    );
    const { descriptionsOf } = groupDescriptions(
      [...named, ...nameless],
      rulesById,
    );
    // step9 (2026-11-17, second request): the same, per sub-name (keyed "#<id>").
    // 2026-11-18: top-level rows only — a split copies its transaction's description, so the
    // description belongs to the main line's sub-name, never to a split's.
    const subDescriptions: Record<number, NameDescriptionView[]> =
      Object.fromEntries(
        [
          ...groupDescriptions(
            named.flatMap((r) =>
              r.subNameId && !r.splitOfId
                ? [{ ...r, name: `#${r.subNameId}` }]
                : [],
            ),
            rulesById,
          ).descriptionsOf,
        ].map(([k, v]) => [Number(k.slice(1)), v]),
      );
    // step9 (2026-11-17, third request): a description a rule assigns to a sub-name is shown
    // even before a row of it arrives (printed as one of the book's rows of it, else its key).
    const printed = new Map<string, string>();
    for (const r of [...named, ...nameless]) {
      const k = descriptionKey(r.description);
      if (k && !printed.has(k)) printed.set(k, r.description);
    }
    for (const r of rules) {
      if (r.matchType !== 'DESCRIPTION' || !r.subNameId) continue;
      const list = (subDescriptions[r.subNameId] ??= []);
      if (list.some((d) => d.key === r.matchKey)) continue;
      if (list.length >= MAX_DESCRIPTIONS) continue;
      list.push({
        key: r.matchKey,
        description: printed.get(r.matchKey) ?? r.matchKey,
        category: r.category ?? UNCATEGORIZED,
        rows: 0,
        rule: {
          id: r.id,
          matchType: 'DESCRIPTION',
          matchKey: r.matchKey,
          text: r.matchKey,
          subName: ruleSubName.get(r.subNameId),
        },
        exceptions: [],
      });
    }
    // step12 (2026-11-20): every exception, on both sides, by the ledger's own rule
    // (`exceptionOwner`) — under a sub-name too, a category-only one too, never cut by the
    // descriptions cap, and a split renamed for itself as one from its transaction's name.
    // A name's usual category (most of its rows) — what a one-time category edit left.
    const usualCategory = new Map<string, string>();
    for (const g of [...groups].sort((a, b) => b._count._all - a._count._all))
      if (g.name && !usualCategory.has(g.name.toLowerCase()))
        usualCategory.set(g.name.toLowerCase(), g.offsetAccount);
    const { exceptionOf, subExceptionOf } = await this.exceptionsOf(
      scope,
      [...named, ...nameless],
      rules,
      descriptionsOf,
      subDescriptions,
      usualCategory,
    );
    const subContains: Record<number, NameView['followsContains']> = {};
    for (const r of rules) {
      if (r.matchType !== 'CONTAINS' || !r.subNameId) continue;
      (subContains[r.subNameId] ??= []).push({
        key: r.matchKey,
        text: r.includeChars ?? r.matchKey,
        category: r.category,
        rows: [...named, ...nameless].filter(
          (t) => !t.splitOfId && t.personalRuleId === r.id,
        ).length,
      });
    }
    const shareOf = rowShares([...named, ...nameless]);
    const totalOf = new Map<string, number>();
    for (const r of named) {
      const key = r.name!.toLowerCase();
      totalOf.set(key, (totalOf.get(key) ?? 0) + shareOf(r));
    }
    const agenciesOf = new Map<string, number[]>();
    const aloneKeys = new Set<string>();
    for (const p of picks) {
      const key = nameTaxKey(p.name);
      agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
      if (p.alone) aloneKeys.add(key);
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
          agencyAlone: aloneKeys.has(nameTaxKey(name)),
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
              // step8 (check1.png): the rows this rule NAMES — an exact description rule of
              // another name wins rows the text also reaches, and they are not this name's.
              rows: [...named, ...nameless].filter(
                (t) => !t.splitOfId && t.personalRuleId === r.id,
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
    const unclarifiedExceptions = !!descriptionsOf
      .get(nameKey(UNCLARIFIED_NAME))
      ?.some((d) => d.exceptions.length);
    if (nameless.length || unclarifiedExceptions) {
      names.push({
        name: UNCLARIFIED_NAME,
        category: UNCATEGORIZED,
        otherCategories: 0,
        type: 'OTHER',
        rows: nameless.length,
        total: nameless.reduce((n, r) => n + shareOf(r), 0) / 100,
        agencyIds: agenciesOf.get(nameTaxKey(null)) ?? [],
        agencyAlone: aloneKeys.has(nameTaxKey(null)),
        fields: [],
        descriptions: [
          ...unrecognized.slice(0, MAX_DESCRIPTIONS).map((u) => ({
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
          ...(descriptionsOf
            .get(nameKey(UNCLARIFIED_NAME))
            ?.filter(
              (d) =>
                d.exceptions.length &&
                !unrecognized
                  .slice(0, MAX_DESCRIPTIONS)
                  .some((u) => u.key === d.key),
            ) ?? []),
        ],
        followsContains: [],
        exceptionOf: exceptionOf.get(nameKey(UNCLARIFIED_NAME)) ?? [],
        group: 'OTHER',
        ruleKey: '',
        rule: null,
        unclarified: true,
      });
      names.sort((a, b) => a.name.localeCompare(b.name));
    }

    // step2 (2026-11-11): a name with files but no transactions — or added by hand — is
    // still listed (its folder holds the files), unlike an empty chart category.
    const listed = new Set(names.map((n) => nameKey(n.name)));
    // step9 part 3: a sub-name's own folder is listed under its parent, not as a name.
    for (const s of await this.prisma.subName.findMany({
      where: { bookId: scope.bookId },
      select: { name: true },
    }))
      listed.add(nameKey(s.name));
    const extra = [
      ...placed.filter((l) => l.manual).map((l) => l.name),
      ...fileNames,
    ];
    for (const name of extra) {
      const key = nameKey(name);
      if (listed.has(key)) continue;
      listed.add(key);
      names.push({
        name,
        category: UNCATEGORIZED,
        otherCategories: 0,
        type: typeOfCategory(UNCATEGORIZED, ctx),
        rows: 0,
        total: 0,
        agencyIds: agenciesOf.get(nameTaxKey(name)) ?? [],
        agencyAlone: aloneKeys.has(nameTaxKey(name)),
        fields: fieldsOf.get(key) ?? [],
        descriptions: [],
        followsContains: [],
        exceptionOf: [],
        group: groupOf.get(key) ?? typeOfCategory(UNCATEGORIZED, ctx),
        ruleKey: key,
        rule: null,
      });
    }
    names.sort((a, b) => a.name.localeCompare(b.name));

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

    return {
      names,
      unrecognized,
      containsRules,
      groups: groupList,
      subDescriptions,
      subContains,
      subExceptionOf,
    };
  }

  /**
   * step12 (2026-11-20): the exceptions of a book's rows for the Names tab. The MAIN side (the
   * name / sub-name the description belongs to) lists them under that description — the
   * description is added when it is not there (no rows of its own left, or past the cap);
   * the row's OWN side (its sub-name, else its name) gets "exception from <main>". A split
   * the customer named apart from its transaction counts as one from the transaction's name.
   */
  private async exceptionsOf(
    scope: BookScope,
    rows: ReadonlyArray<{
      id: number;
      splitOfId: number | null;
      name?: string | null;
      subNameId: number | null;
      description: string;
      offsetAccount: string;
      exceptionRuleId: number | null;
      ruleName: string | null;
      manualEdit: boolean;
      splitRuleId?: number | null;
    }>,
    rules: ReadonlyArray<{
      matchType: string;
      matchKey: string;
      name: string | null;
      category: string | null;
      subNameId: number | null;
    }>,
    descriptionsOf: Map<string, NameDescriptionView[]>,
    subDescriptions: Record<number, NameDescriptionView[]>,
    usualCategory: ReadonlyMap<string, string>,
  ): Promise<{
    exceptionOf: Map<string, NameView['exceptionOf']>;
    subExceptionOf: Record<number, NameView['exceptionOf']>;
  }> {
    const subs = await this.prisma.subName.findMany({
      where: { bookId: scope.bookId },
      select: { id: true, name: true },
    });
    const subName = new Map(subs.map((s) => [s.id, s.name]));
    const ownerOf = new Map(
      rules
        .filter((r) => r.matchType === 'DESCRIPTION')
        .map((r) => [r.matchKey, r]),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Names the Names tab lists (they have rows) — a main side elsewhere is "Unclarified name".
    const listed = new Set(descriptionsOf.keys());
    const exceptionOf = new Map<
      string,
      Map<string, NameView['exceptionOf'][number]>
    >();
    const subExceptionOf = new Map<
      number,
      Map<string, NameView['exceptionOf'][number]>
    >();

    for (const r of rows) {
      const key =
        descriptionKey(r.description) || r.description.trim().toLowerCase();
      const parent = r.splitOfId ? byId.get(r.splitOfId) : undefined;
      // A hand-made split named apart from its transaction (never a split rule's).
      let main: {
        label: string;
        name: string | null;
        subNameId: number | null;
        categoryOnly?: true;
      } | null = parent
        ? !r.splitRuleId &&
          nameKey(r.name ?? '') !== nameKey(parent.name ?? '') &&
          r.name
          ? {
              label: parent.name ?? UNCLARIFIED_NAME,
              name: parent.name ?? null,
              subNameId: null,
            }
          : null
        : exceptionOwner(
            { ...r, name: r.name ?? null },
            ownerOf.get(key),
            (id) => subName.get(id),
          );
      // A one-time category edit no rule can tell apart (nothing knows the name's category,
      // so no EXCEPTION rule): it is one when it left the name's usual category.
      if (
        !main &&
        !parent &&
        r.manualEdit &&
        r.exceptionRuleId === null &&
        r.name &&
        nameKey(r.ruleName ?? r.name) === nameKey(r.name)
      ) {
        const usual = usualCategory.get(r.name.toLowerCase());
        if (usual && usual !== r.offsetAccount)
          main = {
            label: r.name,
            name: r.name,
            subNameId: null,
            categoryOnly: true,
          };
      }
      if (!main) continue;
      // The rules give it a name no row has (a nameless row the description names now): it
      // left the Unclarified rows.
      if (
        main.subNameId === null &&
        main.name &&
        !listed.has(main.name.toLowerCase())
      )
        main = { label: UNCLARIFIED_NAME, name: null, subNameId: null };
      const own =
        (r.subNameId !== null && subName.get(r.subNameId)) ||
        r.name ||
        UNCLARIFIED_NAME;

      // The main side: under the description.
      const list =
        main.subNameId !== null
          ? (subDescriptions[main.subNameId] ??= [])
          : (() => {
              const k = (main.name ?? UNCLARIFIED_NAME).toLowerCase();
              const l = descriptionsOf.get(k) ?? [];
              descriptionsOf.set(k, l);
              return l;
            })();
      let d = list.find((x) => x.key === key);
      if (!d) {
        const rule = ownerOf.get(key);
        d = {
          key,
          description: (parent ?? r).description,
          category: rule?.category ?? r.offsetAccount,
          rows: 0,
          rule: null,
          exceptions: [],
        };
        list.push(d);
      }
      const label = own;
      let e = d.exceptions.find(
        (x) =>
          x.name.toLowerCase() === label.toLowerCase() &&
          (x.category ?? null) === (main.categoryOnly ? r.offsetAccount : null),
      );
      if (!e) {
        e = {
          name: label,
          rows: 0,
          ...(main.categoryOnly && { category: r.offsetAccount }),
          ...(parent && { split: true as const }),
        };
        d.exceptions.push(e);
      }
      e.rows++;
      d.exceptions.sort((a, b) => b.rows - a.rows);
      if (main.categoryOnly) continue;

      // The row's own side: "exception from <main>".
      const mine: Map<string, NameView['exceptionOf'][number]> =
        (r.subNameId !== null
          ? subExceptionOf.get(r.subNameId)
          : exceptionOf.get(own.toLowerCase())) ??
        new Map<string, NameView['exceptionOf'][number]>();
      if (r.subNameId !== null) subExceptionOf.set(r.subNameId, mine);
      else exceptionOf.set(own.toLowerCase(), mine);
      const xKey = `${main.label.toLowerCase()}|${key}`;
      const x = mine.get(xKey) ?? {
        main: main.label,
        key,
        description: (parent ?? r).description,
        rows: 0,
        ...(parent && { split: true as const }),
      };
      x.rows++;
      mine.set(xKey, x);
    }
    return {
      exceptionOf: new Map(
        [...exceptionOf.entries()].map(([k, v]) => [k, [...v.values()]]),
      ),
      subExceptionOf: Object.fromEntries(
        [...subExceptionOf.entries()].map(([k, v]) => [k, [...v.values()]]),
      ),
    };
  }

  /**
   * step2 (2026-11-11): the names the book's live files are filed under (`attachmentName`),
   * in their most common spelling — Unsorted (no name) left out.
   */
  private async namesOfFiles(scope: BookScope): Promise<string[]> {
    const rows = await this.prisma.transactionAttachment.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        // A voice note that was only a message is not a file (`NOT_VOICE_MESSAGE`).
        NOT: { kind: 'AUDIO', status: 'DOCUMENT' },
      },
      select: {
        nameOverride: true,
        extracted: true,
        transaction: {
          select: {
            name: true,
            statement: { select: { deletedAt: true, status: true } },
          },
        },
      },
    });
    const spellings = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const t = r.transaction;
      const live =
        t && !t.statement.deletedAt && t.statement.status === 'DONE' ? t : null;
      const name = attachmentName({
        nameOverride: r.nameOverride,
        transaction: live,
        reading: r.extracted as NameInput['reading'],
      });
      if (!name) continue;
      const key = nameKey(name);
      const m = spellings.get(key) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + 1);
      spellings.set(key, m);
    }
    return [...spellings.values()].map(
      (m) =>
        [...m.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        )[0][0],
    );
  }

  /**
   * step2 (2026-11-11): add a name by hand on the Names tab — it is listed from now on even
   * with no transactions, ready for files. An existing name just becomes manual.
   */
  async addName(
    scope: BookScope,
    rawName: string,
    group: string | null,
  ): Promise<string> {
    const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 191);
    if (!name || nameKey(name) === nameKey(UNCLARIFIED_NAME))
      throw new BadRequestException('Give the name');
    if (group) await this.setNameGroup(scope, name, group);
    const rows = await this.prisma.ledgerName.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true },
    });
    const existing = rows.find((r) => nameKey(r.name) === nameKey(name));
    if (existing) {
      await this.prisma.ledgerName.update({
        where: { id: existing.id },
        data: { manual: true },
      });
      return existing.name;
    }
    await this.prisma.ledgerName.create({
      data: { ...scopeWhere(scope), name, manual: true },
    });
    return name;
  }

  /**
   * step9: put a name in a Names-tab group — a label only (its accounts and tax stay).
   * `group` null = follow its category again. One `LedgerName` row per name and book.
   */
  /** A customer's own group (`g<id>`) must still exist; a built-in one always does. */
  async checkGroup(scope: BookScope, group: string | null): Promise<void> {
    if (!group || !/^g\d+$/.test(group)) return;
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

  async setNameGroup(
    scope: BookScope,
    rawName: string,
    group: string | null,
  ): Promise<void> {
    const name = rawName.trim();
    if (!name || nameKey(name) === nameKey(UNCLARIFIED_NAME))
      throw new BadRequestException('Pick a name');
    // step9 (2026-11-17, second request): a name with sub-names has no settings of its own.
    await refuseWrapper(this.prisma, scope, name);
    await this.checkGroup(scope, group);
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
    await refuseWrapper(this.prisma, scope, name);
    const data = cleanNameFields(input);
    const existing = await this.prisma.ledgerName.findFirst({
      where: { ...scopeWhere(scope), name },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.ledgerName.update({
        where: { id: existing.id },
        data: { fields: data },
      });
    } else if (data !== Prisma.DbNull) {
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
   * The split rules of one name — the whole set. step9 part 4: a rule added splits the
   * name's existing rows NOW, once (`SplitRulesService.apply`), and every new row later; a
   * rule removed only stops — the splits it made are regular splits and stay.
   */
  async setNameAgencies(
    scope: BookScope,
    name: string,
    agencyIds: number[],
    alone = false,
  ): Promise<NamesView> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Which name?');
    // step9 (2026-11-17, second request): a wrapper's split rules live on its sub-names.
    await refuseWrapper(this.prisma, scope, clean);
    await this.writePicks(scope, clean, agencyIds, alone);
    return this.names(scope);
  }

  /**
   * The rules picked for `clean` (a name, or step9 part 3 a sub-name's name): a pick that
   * stays is kept, the others go, new ones come — and split the rows of `clean` at once.
   * step9 (2026-11-19): `alone` = ONE rule of a split group picked on its own — no group
   * expansion; it cuts like an individual rule (`LedgerNameAgency.alone`).
   */
  async writePicks(
    scope: BookScope,
    clean: string,
    agencyIds: number[],
    alone = false,
  ): Promise<void> {
    let ids = [...new Set(agencyIds)];
    if (alone && ids.length !== 1)
      throw new BadRequestException('Pick one split rule to apply on its own.');
    if (alone) {
      const owned = await this.prisma.taxAgency.count({
        where: { ...scopeWhere(scope), deletedAt: null, id: ids[0] },
      });
      if (!owned) throw new NotFoundException('Split rule not found');
    }
    if (ids.length && !alone) {
      const owned = await this.prisma.taxAgency.findMany({
        where: { ...scopeWhere(scope), deletedAt: null, id: { in: ids } },
        select: { groupId: true },
      });
      if (owned.length !== ids.length)
        throw new NotFoundException('Split rule not found');
      // step9 (2026-11-18, part 3): ONE pick per name — a single rule or a single group.
      const units = new Set(
        owned.map((a, i) => (a.groupId === null ? `r${i}` : `g${a.groupId}`)),
      );
      if (units.size > 1)
        throw new BadRequestException(
          'A name takes one split rule or one split group — put the rules in a group to apply several together.',
        );
      // step9 (2026-11-17): a split group is picked as one — any of its rules brings all.
      const groupIds = [
        ...new Set(
          owned.flatMap((a) => (a.groupId === null ? [] : [a.groupId])),
        ),
      ];
      if (groupIds.length) {
        const members = await this.prisma.taxAgency.findMany({
          where: {
            ...scopeWhere(scope),
            deletedAt: null,
            groupId: { in: groupIds },
          },
          select: { id: true },
        });
        ids = [...new Set([...ids, ...members.map((m) => m.id)])];
      }
    }
    const key = nameTaxKey(clean);
    const existing = await this.prisma.ledgerNameAgency.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true, agencyId: true, alone: true },
    });
    // MySQL compares case-insensitively; matched the same way here. A pick that changes
    // between "alone" and "with its group" is a new pick (it cuts differently).
    const mine = existing.filter((e) => nameTaxKey(e.name) === key);
    const kept = new Set(
      mine
        .filter((e) => ids.includes(e.agencyId) && e.alone === alone)
        .map((e) => e.agencyId),
    );
    const added = ids.filter((agencyId) => !kept.has(agencyId));
    await this.prisma.$transaction([
      this.prisma.ledgerNameAgency.deleteMany({
        where: {
          id: {
            in: mine.filter((e) => !kept.has(e.agencyId)).map((e) => e.id),
          },
        },
      }),
      this.prisma.ledgerNameAgency.createMany({
        data: added.map((agencyId) => ({
          ...scopeWhere(scope),
          name: clean,
          agencyId,
          alone,
          appliedAt: new Date(),
        })),
      }),
    ]);
    if (added.length)
      await this.splitRules.apply(scope, { names: [clean], ruleIds: added });
  }

  /**
   * step9 part 3: a sub-name's name changed — its agency picks (keyed by its name) and the
   * files filed under it follow. When `into` already has picks (a merge), the old ones go.
   */
  async moveSubNameKeys(
    scope: BookScope,
    oldName: string,
    newName: string,
  ): Promise<void> {
    const from = nameTaxKey(oldName);
    const to = nameTaxKey(newName);
    if (from === to) return;
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true },
    });
    const mine = picks.filter((p) => nameTaxKey(p.name) === from);
    if (mine.length) {
      const theirs = picks.some((p) => nameTaxKey(p.name) === to);
      const ids = mine.map((p) => p.id);
      if (theirs)
        await this.prisma.ledgerNameAgency.deleteMany({
          where: { id: { in: ids } },
        });
      else
        await this.prisma.ledgerNameAgency.updateMany({
          where: { id: { in: ids } },
          data: { name: newName },
        });
    }
    await this.moveNameFiles(scope, [oldName], newName);
  }

  /** step9 part 3: a sub-name that goes takes its own picks with it (files go to `parent`). */
  async dropSubNameKeys(
    scope: BookScope,
    name: string,
    parent: string | null,
  ): Promise<void> {
    const key = nameTaxKey(name);
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true },
    });
    const ids = picks
      .filter((p) => nameTaxKey(p.name) === key)
      .map((p) => p.id);
    if (ids.length)
      await this.prisma.ledgerNameAgency.deleteMany({
        where: { id: { in: ids } },
      });
    if (parent) await this.moveNameFiles(scope, [name], parent);
  }

  /**
   * A rename carries the names' split rules over to the new name (`saveRule`). The rows
   * already split keep their splits. step9 (2026-11-18, part 3): one pick per name — a new
   * name with its own picks keeps them, else it takes the first old name's (a rule or a group).
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
      select: { name: true, agencyId: true, alone: true },
    });
    const target = nameTaxKey(newName);
    if (rows.some((r) => nameTaxKey(r.name) === target)) return;
    const from = oldNames
      .map(nameTaxKey)
      .find((k) => rows.some((r) => nameTaxKey(r.name) === k));
    if (from === undefined) return;
    const add = rows.filter((r) => nameTaxKey(r.name) === from);
    await this.prisma.ledgerNameAgency.createMany({
      data: add.map(({ agencyId, alone }) => ({
        ...scopeWhere(scope),
        name: newName,
        agencyId,
        alone,
        appliedAt: new Date(),
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
    await this.moveNameFiles(scope, oldNames, newName);
    await this.copyNameRow(scope, keys, target, newName);
    // After the copy, so a new target row takes the old one's group and switches.
    await this.moveSubNames(scope, oldNames, newName);
  }

  /** The old name's `LedgerName` settings onto a new row for `newName` (none there yet). */
  private async copyNameRow(
    scope: BookScope,
    keys: ReadonlySet<string>,
    target: string,
    newName: string,
  ): Promise<void> {
    const rows = await this.prisma.ledgerName.findMany({
      where: scopeWhere(scope),
      select: {
        id: true,
        name: true,
        group: true,
        taxExempt: true,
        fields: true,
        manual: true,
      },
    });
    const from = rows.find((r) => keys.has(nameTaxKey(r.name)));
    if (!from) return;
    const there = rows.find((r) => nameTaxKey(r.name) === target);
    // step9 (2026-11-19): its default custom-column answers follow (the target's own stay).
    if (there) {
      await moveNameAnswers(
        this.prisma,
        { nameId: from.id },
        { nameId: there.id },
      );
      return;
    }
    const made = await this.prisma.ledgerName.create({
      data: {
        ...scopeWhere(scope),
        name: newName,
        group: from.group,
        taxExempt: from.taxExempt,
        fields: (from.fields as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
        manual: from.manual,
      },
      select: { id: true },
    });
    await moveNameAnswers(
      this.prisma,
      { nameId: from.id },
      { nameId: made.id },
    );
  }

  /**
   * step2 (2026-11-15): a renamed / merged name takes its splits and sub-names with it. Rules
   * never touch splits, so their `name` is renamed here; each sub-name moves to the new
   * name's `LedgerName` ("<new> - <category>"), joining one the new name already has in the
   * same category.
   */
  async moveSubNames(
    scope: BookScope,
    oldNames: readonly string[],
    newName: string,
  ): Promise<void> {
    const target = nameTaxKey(newName);
    const old = [
      ...new Set(oldNames.map(nameTaxKey).filter((k) => k && k !== target)),
    ];
    if (!old.length) return;
    // MySQL compares names case-insensitively.
    await this.prisma.bankTransaction.updateMany({
      where: {
        ...scopeWhere(scope),
        splitOfId: { not: null },
        name: { in: old },
      },
      data: { name: newName },
    });
    const names = await this.prisma.ledgerName.findMany({
      where: scopeWhere(scope),
      select: { id: true, name: true },
    });
    const fromIds = names
      .filter((n) => old.includes(nameTaxKey(n.name)))
      .map((n) => n.id);
    if (!fromIds.length) return;
    const subs = await this.prisma.subName.findMany({
      where: { bookId: scope.bookId, nameId: { in: fromIds } },
    });
    if (!subs.length) return;
    const into =
      names.find((n) => nameTaxKey(n.name) === target)?.id ??
      (
        await this.prisma.ledgerName.create({
          data: { ...scopeWhere(scope), name: newName },
          select: { id: true },
        })
      ).id;
    for (const sub of subs) {
      const same = await this.prisma.subName.findFirst({
        where: {
          bookId: scope.bookId,
          nameId: into,
          category: sub.category,
          splitKey: sub.splitKey,
        },
        select: { id: true },
      });
      if (same) {
        await this.prisma.bankTransaction.updateMany({
          where: { ...scopeWhere(scope), subNameId: sub.id },
          data: { subNameId: same.id },
        });
        await this.prisma.subName.delete({ where: { id: sub.id } });
        const kept = await this.prisma.subName.findUnique({
          where: { id: same.id },
          select: { name: true },
        });
        if (kept) await this.moveSubNameKeys(scope, sub.name, kept.name);
      } else {
        // step9 part 3: a name the customer gave it stays; its settings follow a new one.
        const name = sub.renamed
          ? sub.name
          : sub.splitKey
            ? splitSubNameOf(
                newName,
                sub.category,
                splitLabelOf(
                  sub.name,
                  names.find((n) => n.id === sub.nameId)?.name ?? '',
                  sub.category,
                ),
              )
            : subNameOf(newName, sub.category);
        await this.prisma.subName.update({
          where: { id: sub.id },
          data: { nameId: into, name },
        });
        await this.moveSubNameKeys(scope, sub.name, name);
      }
    }
  }

  /**
   * step2 (2026-11-11): a renamed / merged name takes its files with it — the files the
   * customer filed under the old name (`nameOverride`) and its subfolders (`NameFolder`).
   * Files that follow their transaction move by themselves.
   */
  async moveNameFiles(
    scope: BookScope,
    oldNames: readonly string[],
    newName: string,
  ): Promise<void> {
    const keys = new Set(oldNames.map(nameKeyOf));
    keys.delete(nameKeyOf(newName));
    if (!keys.size) return;
    const files = await this.prisma.transactionAttachment.findMany({
      where: { ...scopeWhere(scope), nameOverride: { not: null } },
      select: { id: true, nameOverride: true },
    });
    const ids = files
      .filter((f) => keys.has(nameKeyOf(f.nameOverride!)))
      .map((f) => f.id);
    if (ids.length) {
      await this.prisma.transactionAttachment.updateMany({
        where: { id: { in: ids } },
        data: { nameOverride: newName.trim().slice(0, 191) },
      });
    }
    await this.prisma.nameFolder.updateMany({
      where: { ...scopeWhere(scope), name: { in: [...keys] } },
      data: { name: nameKeyOf(newName) },
    });
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
  manualEdit: true,
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
  }>,
  rulesById: ReadonlyMap<
    number,
    {
      matchType: string;
      matchKey: string;
      includeChars: string | null;
      subName?: string | null;
    }
  >,
): {
  descriptionsOf: Map<string, NameDescriptionView[]>;
} {
  type Group = {
    description: string;
    categories: Map<string, number>;
    rules: Map<number, number>;
    rows: number;
  };
  const byName = new Map<string, Map<string, Group>>();
  for (const r of rows) {
    const name = (r.name ?? UNCLARIFIED_NAME).toLowerCase();
    const key =
      descriptionKey(r.description) || r.description.trim().toLowerCase();
    const groups = byName.get(name) ?? new Map<string, Group>();
    byName.set(name, groups);
    const g = groups.get(key) ?? {
      description: r.description,
      categories: new Map<string, number>(),
      rules: new Map<number, number>(),
      rows: 0,
    };
    groups.set(key, g);
    g.rows++;
    g.categories.set(
      r.offsetAccount,
      (g.categories.get(r.offsetAccount) ?? 0) + 1,
    );
    if (r.personalRuleId !== null)
      g.rules.set(r.personalRuleId, (g.rules.get(r.personalRuleId) ?? 0) + 1);
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
                    ...(rule.subName && { subName: rule.subName }),
                  }
                : null,
            exceptions: [],
          };
        })
        .sort(
          (a, b) =>
            b.rows - a.rows || a.description.localeCompare(b.description),
        )
        .slice(0, MAX_DESCRIPTIONS),
    );
  }
  return { descriptionsOf };
}

/**
 * step2 (2026-11-09): a name's (step9 part 3: or sub-name's) profile, cleaned — a phone in
 * E.164 (400 when it is not one), an email lower-cased; empty values are dropped. DbNull
 * when nothing is left.
 */
export function cleanNameFields(
  input: NameFieldDto[],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
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
  return fields.length
    ? (fields as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull;
}
