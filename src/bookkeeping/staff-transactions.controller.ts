import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
import {
  CustomerAccountsService,
  type AccountView,
} from './customer-accounts.service';
import { EditTransactionDto } from './dto/agency.dto';
import { LedgerQueryDto, ledgerQueryOf } from './dto/ledger-query.dto';
import { LedgerQueryService } from './ledger-query.service';
import type { LedgerSummary } from './ledger-query.util';
import { NameMemoryService } from './name-memory.service';
import { bookLabel } from './scope';
import { Staff, StaffBookGuard, type StaffBook } from './staff-book.guard';

/** One row of the internal app's "Bank transactions" tab — never the bank description. */
export interface StaffTransactionRow {
  key: string;
  id: number;
  kind: 'transaction' | 'split';
  splitOfId: number | null;
  date: string | null;
  name: string | null;
  subName: string | null;
  category: string;
  amount: number;
  /** A transaction with splits: the full bank amount (`amount` is what its splits leave). */
  fullAmount: number | null;
  account: string;
  /** Transactions only: where it stands in QuickBooks. */
  qbo: { id: string | null; syncedAt: string | null; error: string | null } | null;
}

export interface StaffTransactionPage {
  rows: StaffTransactionRow[];
  nextOffset: number | null;
}

/**
 * `/api/staff/books/:companyId/transactions` — step11 (internal, 2026-11-23): the company's
 * bank transactions with their name and category for the internal app, and the one way
 * staff change them: through the customer's OWN edit path (rules, sub-names, the name's one
 * category behave exactly as on the site), after which the change goes to QuickBooks at
 * once. Called ONLY by the internal API (`StaffBookGuard`); a write needs `canEdit`.
 */
@Controller('staff/books/:companyId/transactions')
@UseGuards(StaffBookGuard)
export class StaffTransactionsController {
  private readonly logger = new Logger(StaffTransactionsController.name);

  constructor(
    private readonly ledgerQuery: LedgerQueryService,
    private readonly accounts: CustomerAccountsService,
    private readonly nameMemory: NameMemoryService,
    private readonly qbo: QuickBooksSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('page')
  async page(
    @Staff() staff: StaffBook,
    @Query() dto: LedgerQueryDto,
  ): Promise<StaffTransactionPage> {
    const { query, offset, limit } = ledgerQueryOf(dto);
    const page = await this.ledgerQuery.page(staff.scope, query, offset, limit);
    const rows = page.rows.filter(
      (r) => r.kind === undefined || r.kind === 'split',
    );
    const top = rows.filter((r) => r.kind === undefined).map((r) => r.id);
    const qbo = top.length
      ? await this.prisma.bankTransaction.findMany({
          where: { id: { in: top } },
          select: { id: true, qboId: true, qboSyncedAt: true, qboError: true },
        })
      : [];
    const byId = new Map(qbo.map((q) => [q.id, q]));
    return {
      nextOffset: page.nextOffset,
      rows: rows.map((r) => {
        const q = byId.get(r.id);
        const split = r.kind === 'split';
        return {
          key: r.key,
          id: r.id,
          kind: split ? 'split' : 'transaction',
          splitOfId: r.splitOfId ?? null,
          date: r.postingDate ?? r.pendingDate,
          name: r.name,
          subName: r.subName?.name ?? null,
          category: r.offsetAccount,
          amount: r.amount,
          fullAmount: r.fullAmount ?? null,
          account: r.statementLabel,
          qbo:
            split || !q
              ? null
              : {
                  id: q.qboId,
                  syncedAt: q.qboSyncedAt?.toISOString() ?? null,
                  error: q.qboError,
                },
        };
      }),
    };
  }

  @Get('summary')
  summary(
    @Staff() staff: StaffBook,
    @Query() dto: LedgerQueryDto,
  ): Promise<LedgerSummary> {
    return this.ledgerQuery.summary(staff.scope, ledgerQueryOf(dto).query);
  }

  @Get('categories')
  categories(@Staff() staff: StaffBook): Promise<AccountView[]> {
    return this.accounts.list(staff.scope);
  }

  /** A transaction's name and / or category — the customer's own edit, then QuickBooks. */
  @Patch(':id')
  @HttpCode(204)
  async edit(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Param('id', ParseIntPipe) id: number,
    @Staff() staff: StaffBook,
    @Body() dto: EditTransactionDto,
  ): Promise<void> {
    const { name, category } = await this.accounts.editValues(staff.scope, dto);
    // Staff's word moves a description another name holds (as on the Rules tab).
    await this.nameMemory.editTransaction(staff.scope, id, {
      name,
      category,
      scope: dto.scope,
      replace: true,
    });
    this.logger.log(
      `staff user #${staff.staffUserId} edited transaction #${id} (${[
        name && `name "${name}"`,
        category && `category "${category}"`,
        dto.scope,
      ]
        .filter(Boolean)
        .join(', ')}) for ${bookLabel(staff.scope)}`,
    );
    this.qbo.syncSoon(staff.scope.bookId);
  }
}
