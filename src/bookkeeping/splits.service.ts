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
import { ProductMemoryService } from './product-memory.service';
import { itemKey } from './receipt-items.util';
import { scopeWhere, type BookScope } from './scope';
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
    private readonly products: ProductMemoryService,
  ) {}

  /**
   * Replace the transaction's splits with `input`: listed ids are updated, new ones made,
   * the rest removed. Then the parent's and the splits' taxes are decided again, so the
   * ledger and the reports are right as soon as this returns.
   */
  async save(scope: BookScope, id: number, input: SplitInput[]): Promise<void> {
    const parent = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        ...scopeWhere(scope),
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
        category: await this.accounts.validCategory(scope, s.category),
        amount: signedLike(amount, s.amount),
      })),
    );

    // The bank side of the parent is the bank side of every split.
    const bank = amount < 0 ? parent.creditAccount : parent.debitAccount;
    const keep = new Set(rows.flatMap((r) => (r.id != null ? [r.id] : [])));
    await this.prisma.$transaction(async (tx) => {
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
              ...scopeWhere(scope),
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
      return out;
    });
    // "Always": this item goes in this category on every later receipt, and the
    // customer's other rows of it move too — the same rule as the Products tab.
    for (const r of rows) {
      if (r.always && r.itemName && itemKey(r.itemName)) {
        await this.products.saveRule(scope, r.itemName, r.category);
      }
    }
  }
}
