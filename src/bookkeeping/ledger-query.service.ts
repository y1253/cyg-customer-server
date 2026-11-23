import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookkeepingService } from './bookkeeping.service';
import { CustomColumnsService } from './custom-columns.service';
import {
  isActive,
  pageOfFamilies,
  queryLedger,
  type LedgerQuery,
  type LedgerRow,
  type LedgerSummary,
} from './ledger-query.util';
import { scopeWhere, type BookScope } from './scope';

export interface LedgerPage {
  rows: LedgerRow[];
  /** The next page's offset (in families); null = this was the last one. */
  nextOffset: number | null;
  families: number;
}

/**
 * step11 (2026-11-23, user's request): the ledger page by page — filtered, sorted and totalled
 * here (`ledger-query.util.ts`) instead of in the browser. The rows are built by the one
 * builder, `BookkeepingService.transactions` (starting balances, revaluations and what each
 * transaction's splits leave all need the whole book).
 */
@Injectable()
export class LedgerQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookkeeping: BookkeepingService,
    private readonly customColumns: CustomColumnsService,
  ) {}

  async page(
    scope: BookScope,
    query: LedgerQuery,
    offset: number,
    limit: number,
  ): Promise<LedgerPage> {
    const { families } = await this.run(scope, query);
    return {
      ...pageOfFamilies(families, offset, limit),
      families: families.length,
    };
  }

  async summary(scope: BookScope, query: LedgerQuery): Promise<LedgerSummary> {
    return (await this.run(scope, query)).summary;
  }

  private async run(scope: BookScope, query: LedgerQuery) {
    const customKeys = [
      ...Object.keys(query.filters ?? {}).filter((k) =>
        isActive(query.filters![k]),
      ),
      ...(query.sort ? [query.sort.key] : []),
    ].filter((k) => /^c\d+$/.test(k));
    const [all, statements, custom] = await Promise.all([
      this.bookkeeping.transactions(scope),
      this.prisma.bankStatement.findMany({
        where: {
          ...scopeWhere(scope),
          deletedAt: null,
          status: StatementStatus.DONE,
        },
        select: { id: true, periodEnd: true },
      }),
      // Custom-column answers are read only when a custom column sorts or filters.
      customKeys.length ? this.customColumns.view(scope) : null,
    ]);
    return queryLedger(all, query, {
      periodEnd: new Map(
        statements.map((s) => [
          s.id,
          s.periodEnd ? s.periodEnd.toISOString().slice(0, 10) : null,
        ]),
      ),
      columns: custom?.columns,
      answerText: custom
        ? (columnId, transactionId) => {
            const a = custom.answers[transactionId]?.[columnId];
            if (!a) return null;
            const col = custom.columns.find((c) => c.id === columnId);
            if (col?.type === 'DROPDOWN')
              return (
                col.options.find((o) => o.id === a.dropDownId)?.label ?? null
              );
            return a.value;
          }
        : undefined,
    });
  }
}
