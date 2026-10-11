import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  async list(customerId: number): Promise<AccountView[]> {
    const own = await this.own(customerId);
    return [
      ...CHART_OF_ACCOUNTS.map((a) => ({ ...a, custom: false })),
      ...own.map((a) => ({ ...a, custom: true })),
    ];
  }

  /** The customer's own accounts' types, by name — for reports, tax and the Names tab. */
  async types(customerId: number): Promise<Map<string, AccountType>> {
    return new Map((await this.own(customerId)).map((a) => [a.name, a.type]));
  }

  /** The customer's own account names — what `normalizeAccount` accepts beyond the chart. */
  async names(customerId: number): Promise<Set<string>> {
    return new Set((await this.own(customerId)).map((a) => a.name));
  }

  /**
   * Is `name` a category this customer may use? Returns the stored spelling (the chart's or
   * their own), so "office expense" saves as "Office Expense". Throws otherwise.
   */
  async validCategory(customerId: number, name: string): Promise<string> {
    const wanted = name.trim().toLowerCase();
    const chart = ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
    if (chart) return chart;
    const own = (await this.own(customerId)).find(
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
    customerId: number,
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
      where: { customerId, name, deletedAt: null },
      select: { id: true },
    });
    if (agency) {
      throw new BadRequestException(`"${name}" is one of your tax agencies`);
    }
    const existing = await this.prisma.customerAccount.findUnique({
      where: { customerId_name: { customerId, name } },
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
      data: { customerId, name, type: input.type },
    });
    return { name: row.name, type: input.type, custom: true };
  }

  private async own(
    customerId: number,
  ): Promise<Array<{ name: string; type: AccountType }>> {
    const rows = await this.prisma.customerAccount.findMany({
      where: { customerId },
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
