import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isFxCurrency } from './fx.util';
import { scopeWhere, type BookScope } from './scope';
import {
  ACCOUNT_NAMES,
  CHART_OF_ACCOUNTS,
  type AccountType,
} from './chart-of-accounts';

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'INCOME',
  'EXPENSE',
  'ASSET',
  'LIABILITY',
  'EQUITY',
];

/** One category a customer may pick: the fixed chart plus their own. */
export interface AccountView {
  name: string;
  type: AccountType;
  /** Typed in by the customer, not in the fixed chart. */
  custom: boolean;
}

/**
 * A customer's OWN categories (`CustomerAccount`), typed in when nothing in the fixed chart
 * fits. Everywhere a category is checked against the chart — the AI's answers, the
 * customer's rules and edits, the reports, the tax step — these count too, for that
 * customer only. The `type` decides where the account lands in the reports and whether its
 * rows are taxed as sales (INCOME) or purchases (EXPENSE).
 */
@Injectable()
export class CustomerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The chart, then the customer's own accounts A–Z. */
  async list(scope: BookScope): Promise<AccountView[]> {
    const own = await this.own(scope);
    return [
      ...CHART_OF_ACCOUNTS.map((a) => ({ ...a, custom: false })),
      ...own.map((a) => ({ ...a, custom: true })),
    ];
  }

  /** The customer's own accounts' types, by name — for reports, tax and the Names tab. */
  async types(scope: BookScope): Promise<Map<string, AccountType>> {
    return new Map((await this.own(scope)).map((a) => [a.name, a.type]));
  }

  /** Accounts the customer moved to another section (`CustomerAccountType`), by name. */
  async overrides(scope: BookScope): Promise<Map<string, AccountType>> {
    const rows = await this.prisma.customerAccountType.findMany({
      where: scopeWhere(scope),
      select: { account: true, type: true },
    });
    return new Map(
      rows
        .filter((r) => ACCOUNT_TYPES.includes(r.type as AccountType))
        .map((r) => [r.account, r.type as AccountType]),
    );
  }

  /**
   * Move an account to another section ("drag it to Liabilities") — any chart account,
   * their own category, a tax agency or a statement account. Its rows never change: the
   * type is read wherever an account's section matters (`typeFor`).
   */
  async setType(
    scope: BookScope,
    account: string,
    type: AccountType,
  ): Promise<void> {
    const name = account.trim();
    if (!name) throw new BadRequestException('Which account?');
    if (!ACCOUNT_TYPES.includes(type)) {
      throw new BadRequestException('Choose a section');
    }
    // No compound-key upsert: the key holds companyId, which is NULL for the general book.
    const found = await this.prisma.customerAccountType.findFirst({
      where: { ...scopeWhere(scope), account: name },
      select: { id: true },
    });
    if (found) {
      await this.prisma.customerAccountType.update({
        where: { id: found.id },
        data: { type },
      });
    } else {
      await this.prisma.customerAccountType.create({
        data: { ...scopeWhere(scope), account: name, type },
      });
    }
  }

  /** Back to where the chart (or their own category) puts it. */
  async resetType(scope: BookScope, account: string): Promise<void> {
    await this.prisma.customerAccountType.deleteMany({
      where: { ...scopeWhere(scope), account: account.trim() },
    });
  }

  /**
   * Set the currency of one of the customer's statement accounts — every statement filed
   * under it, now and later, is converted from it (`loadOpeningStatements`). Rows never
   * change; conversion happens on read.
   */
  async setCurrency(
    scope: BookScope,
    account: string,
    currency: string,
  ): Promise<void> {
    const name = account.trim();
    const code = currency.trim().toUpperCase();
    if (!isFxCurrency(code)) {
      throw new BadRequestException(
        `${code} is not a currency we have daily rates for`,
      );
    }
    const statement = await this.prisma.bankStatement.findFirst({
      where: { ...scopeWhere(scope), accountName: name, deletedAt: null },
      select: { id: true },
    });
    if (!statement) {
      throw new BadRequestException(`"${name}" is not one of your accounts`);
    }
    const found = await this.prisma.customerAccountCurrency.findFirst({
      where: { ...scopeWhere(scope), account: name },
      select: { id: true },
    });
    if (found) {
      await this.prisma.customerAccountCurrency.update({
        where: { id: found.id },
        data: { currency: code },
      });
    } else {
      await this.prisma.customerAccountCurrency.create({
        data: { ...scopeWhere(scope), account: name, currency: code },
      });
    }
  }

  /** Back to the currency read off each statement. */
  async resetCurrency(scope: BookScope, account: string): Promise<void> {
    await this.prisma.customerAccountCurrency.deleteMany({
      where: { ...scopeWhere(scope), account: account.trim() },
    });
  }

  /** The customer's own account names — what `normalizeAccount` accepts beyond the chart. */
  async names(scope: BookScope): Promise<Set<string>> {
    return new Set((await this.own(scope)).map((a) => a.name));
  }

  /**
   * Is `name` a category this customer may use? Returns the stored spelling (the chart's or
   * their own), so "office expense" saves as "Office Expense". Throws otherwise.
   */
  async validCategory(scope: BookScope, name: string): Promise<string> {
    const wanted = name.trim().toLowerCase();
    const chart = ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
    if (chart) return chart;
    const own = (await this.own(scope)).find(
      (a) => a.name.toLowerCase() === wanted,
    );
    if (own) return own.name;
    throw new BadRequestException(
      `"${name}" is not one of your categories. Create it first.`,
    );
  }

  /**
   * A new category of the customer's own. Its name may not shadow a chart account or one of
   * their tax agencies (an agency name IS a ledger account). Creating one that already
   * exists with the same type is a no-op, so a double-click never errors.
   */
  async create(
    scope: BookScope,
    input: { name: string; type: AccountType },
  ): Promise<AccountView> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Enter a name for the category');
    if (!ACCOUNT_TYPES.includes(input.type)) {
      throw new BadRequestException('Choose what kind of account it is');
    }
    if (ACCOUNT_NAMES.some((n) => n.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException(
        `"${name}" is already in the list — pick it there`,
      );
    }
    const agency = await this.prisma.taxAgency.findFirst({
      where: { ...scopeWhere(scope), name, deletedAt: null },
      select: { id: true },
    });
    if (agency) {
      throw new BadRequestException(`"${name}" is one of your tax agencies`);
    }
    const existing = await this.prisma.customerAccount.findFirst({
      where: { ...scopeWhere(scope), name },
    });
    if (existing) {
      if (existing.type !== input.type) {
        throw new BadRequestException(
          `You already have a category called "${existing.name}"`,
        );
      }
      return { name: existing.name, type: input.type, custom: true };
    }
    const row = await this.prisma.customerAccount.create({
      data: { ...scopeWhere(scope), name, type: input.type },
    });
    return { name: row.name, type: input.type, custom: true };
  }

  private async own(
    scope: BookScope,
  ): Promise<Array<{ name: string; type: AccountType }>> {
    const rows = await this.prisma.customerAccount.findMany({
      where: scopeWhere(scope),
      select: { name: true, type: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      name: r.name,
      type: ACCOUNT_TYPES.includes(r.type as AccountType)
        ? (r.type as AccountType)
        : 'EXPENSE',
    }));
  }
}
