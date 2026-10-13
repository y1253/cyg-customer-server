import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { doubleEntry } from './ledger.util';
import { cleanName } from './name-memory.util';
import { itemKey } from './receipt-items.util';
import { signedLike, splitProblem } from './splits.util';
import { TaxService } from './tax.service';

export interface SplitInput {
  id?: number;
  name?: string | null;
  /** The receipt line it is for ("Pampers"); null = none. */
  itemName?: string | null;
  category: string;
  /** Positive, as the customer typed it; stored with the parent's sign. */
  amount: number;
  /** Remember this item's category for later receipts (`CustomerItemRule`). */
  always?: boolean;
}

/**
 * Hand-made splits: parts of one bank transaction the customer moves to their own name
 * and category (`splits.util.ts`). Each is a child `BankTransaction`, flagged `manualEdit`
 * so an "Always" rule never rewrites it, and taxed on its own like any row.
 */
@Injectable()
export class SplitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
    private readonly tax: TaxService,
  ) {}

  /**
   * Replace the transaction's splits with `input`: listed ids are updated, new ones made,
   * the rest removed. Then the parent's and the splits' taxes are decided again, so the
   * ledger and the reports are right as soon as this returns.
   */
  async save(
    customerId: number,
    id: number,
    input: SplitInput[],
  ): Promise<void> {
    const parent = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        customerId,
        statement: { deletedAt: null, status: StatementStatus.DONE },
      },
      include: { splits: { select: { id: true } } },
    });
    if (!parent) throw new NotFoundException('Transaction not found');
    if (parent.splitOfId) {
      throw new BadRequestException(
        'This is already a split. Split the transaction it came from instead.',
      );
    }
    const amount = Number(parent.amount);
    const problem = splitProblem(
      amount,
      input.map((s) => s.amount),
    );
    if (problem) throw new BadRequestException(problem);

    const existing = new Set(parent.splits.map((s) => s.id));
    for (const s of input) {
      if (s.id != null && !existing.has(s.id)) {
        throw new BadRequestException('A split was removed meanwhile. Reload.');
      }
    }
    const rows = await Promise.all(
      input.map(async (s) => ({
        id: s.id,
        name: cleanName(s.name ?? null),
        itemName: cleanName(s.itemName ?? null),
        always: s.always === true,
        category: await this.accounts.validCategory(customerId, s.category),
        amount: signedLike(amount, s.amount),
      })),
    );

    // The bank side of the parent is the bank side of every split.
    const bank = amount < 0 ? parent.creditAccount : parent.debitAccount;
    const keep = new Set(rows.flatMap((r) => (r.id != null ? [r.id] : [])));
    const ids = await this.prisma.$transaction(async (tx) => {
      await tx.bankTransaction.deleteMany({
        where: { splitOfId: parent.id, id: { notIn: [...keep] } },
      });
      const out: number[] = [];
      for (const r of rows) {
        const data = {
          name: r.name,
          itemName: r.itemName,
          amount: r.amount.toFixed(2),
          offsetAccount: r.category,
          ...doubleEntry(r.amount, bank, r.category),
        };
        if (r.id != null) {
          await tx.bankTransaction.update({ where: { id: r.id }, data });
          out.push(r.id);
        } else {
          const made = await tx.bankTransaction.create({
            data: {
              ...data,
              statementId: parent.statementId,
              customerId,
              position: parent.position,
              pendingDate: parent.pendingDate,
              postingDate: parent.postingDate,
              description: parent.description,
              manualEdit: true,
              splitOfId: parent.id,
            },
            select: { id: true },
          });
          out.push(made.id);
        }
      }
      // "Always": this item goes in this category on every later receipt.
      for (const r of rows) {
        const key = r.always && r.itemName ? itemKey(r.itemName) : '';
        if (!key) continue;
        await tx.customerItemRule.upsert({
          where: { customerId_itemKey: { customerId, itemKey: key } },
          create: { customerId, itemKey: key, category: r.category },
          update: { category: r.category },
        });
      }
      return out;
    });
    await this.tax.retagRows(customerId, [parent.id, ...ids]);
  }

  /** The category each remembered item goes in, keyed by `itemKey`. */
  async itemRules(customerId: number): Promise<Map<string, string>> {
    const rules = await this.prisma.customerItemRule.findMany({
      where: { customerId },
      select: { itemKey: true, category: true },
    });
    return new Map(rules.map((r) => [r.itemKey, r.category]));
  }
}
