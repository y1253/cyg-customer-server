import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CustomerAuthService } from '../customer-auth/customer-auth.service';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { Book, BookScopeGuard } from './book-scope.guard';
import type { BookScope } from './scope';
import {
  AttachmentsService,
  type AttachmentView,
  type IntakeView,
} from './attachments.service';
import {
  ATTACHMENT_UPLOAD_OPTIONS,
  MAX_FILES_PER_REQUEST as MAX_ATTACHMENTS_PER_REQUEST,
} from './attachment-uploads';
import {
  BookkeepingService,
  type StatementView,
  type TransactionView,
} from './bookkeeping.service';
import {
  CustomerAccountsService,
  type AccountView,
} from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import type { ProductView } from './product-memory.util';
import {
  CreateAccountDto,
  CreateAgencyDto,
  EditTransactionDto,
  MoveStatementDto,
  RenameTaxLineDto,
  ResetNameRuleDto,
  ResetAccountTypeDto,
  SetAccountCurrencyDto,
  ResetProductRuleDto,
  SaveSplitsDto,
  SetAccountTypeDto,
  SaveNameRuleDto,
  SaveProductRuleDto,
  SetAttachmentTransactionDto,
  SetCurrencyDto,
  SetNameAgenciesDto,
  UpdateAgencyDto,
} from './dto/agency.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { LedgerExportService } from './export.service';
import { FxService } from './fx.service';
import { ReportsService } from './reports.service';
import { SplitsService } from './splits.service';
import {
  TaxService,
  type AgencyView,
  type NamesView,
  type TaxSettingsView,
} from './tax.service';
import type { ReportsView } from './reports.util';
import {
  MAX_FILES_PER_REQUEST,
  STATEMENT_UPLOAD_OPTIONS,
} from './statement-uploads';

/** RFC 5987 filename for Content-Disposition, safe for any characters. */
function attachment(filename: string, inline = false): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * `/api/bookkeeping` — every route needs a signed-in customer and acts only on ONE of
 * their books: the general one, or a business of theirs named by `?companyId=`
 * (`BookScopeGuard`, class-level so no route can forget it).
 */
@Controller('bookkeeping')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class BookkeepingController {
  constructor(
    private readonly bookkeeping: BookkeepingService,
    private readonly exporter: LedgerExportService,
    private readonly customers: CustomerAuthService,
    private readonly reportsService: ReportsService,
    private readonly tax: TaxService,
    private readonly nameMemory: NameMemoryService,
    private readonly accounts: CustomerAccountsService,
    private readonly splits: SplitsService,
    private readonly attachments: AttachmentsService,
    private readonly productMemory: ProductMemoryService,
    private readonly fx: FxService,
    private readonly prisma: PrismaService,
  ) {}

  /** Whose name heads an export: the business's for its books, else the customer's. */
  private async ownerName(scope: BookScope): Promise<string> {
    if (scope.companyId !== null) {
      const c = await this.prisma.company.findUnique({
        where: { id: scope.companyId },
        select: { businessName: true },
      });
      if (c) return c.businessName;
    }
    return (await this.customers.me(scope.customerId)).name;
  }

  /**
   * Reads every UPLOADED statement and re-applies changed tax settings — only when it is
   * free (402 otherwise; a paid Generate is `POST /billing/checkout`).
   */
  @Post('generate')
  generate(
    @Book() scope: BookScope,
  ): Promise<{ queued: number; taxing: boolean }> {
    return this.bookkeeping.generateIfFree(scope);
  }

  @Get('tax')
  taxSettings(@Book() scope: BookScope): Promise<TaxSettingsView> {
    return this.tax.settings(scope);
  }

  @Post('agencies')
  createAgency(
    @Book() scope: BookScope,
    @Body() dto: CreateAgencyDto,
  ): Promise<AgencyView> {
    return this.tax.createAgency(scope, dto);
  }

  @Patch('agencies/:id')
  updateAgency(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAgencyDto,
  ): Promise<AgencyView> {
    return this.tax.updateAgency(scope, id, dto);
  }

  @Delete('agencies/:id')
  @HttpCode(204)
  removeAgency(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.tax.removeAgency(scope, id);
  }

  /** Every payee name the AI read (category, type, tax switch, rule) plus the unnamed rows. */
  @Get('names')
  names(@Book() scope: BookScope): Promise<NamesView> {
    return this.tax.names(scope);
  }

  /** Which tax agencies tax one name — the whole set; [] = not taxed (the default). */
  @Put('names/agencies')
  setNameAgencies(
    @Book() scope: BookScope,
    @Body() dto: SetNameAgenciesDto,
  ): Promise<NamesView> {
    return this.tax.setNameAgencies(scope, dto.name, dto.agencyIds);
  }

  /**
   * Save the customer's own name and/or category. Applied to their existing rows at once
   * and to every statement they read from now on (`NameMemoryService`).
   */
  @Put('names/rule')
  async saveNameRule(
    @Book() scope: BookScope,
    @Body() dto: SaveNameRuleDto,
  ): Promise<NamesView> {
    const { name, category } = await this.accounts.editValues(scope, dto);
    await this.nameMemory.saveRule(scope, {
      matchType: dto.matchType,
      matchKey: dto.matchKey,
      name,
      category,
      scope: dto.scope ?? 'ALWAYS',
    });
    return this.tax.names(scope);
  }

  /**
   * Change ONE ledger row's name and/or category. The name goes on just that row (`ONCE`)
   * or on every row with its description (`ALWAYS`); a category is always the name's one
   * category, so every row of that name moves.
   */
  @Patch('transactions/:id')
  @HttpCode(204)
  async editTransaction(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditTransactionDto,
  ): Promise<void> {
    const { name, category } = await this.accounts.editValues(scope, dto);
    await this.nameMemory.editTransaction(scope, id, {
      name,
      category,
      scope: dto.scope,
    });
  }

  /**
   * Split a transaction by hand: its whole set of splits, each with an amount, a name and
   * a category. They may not add up to more than the transaction.
   */
  @Put('transactions/:id/splits')
  @HttpCode(204)
  saveSplits(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveSplitsDto,
  ): Promise<void> {
    return this.splits.save(scope, id, dto.splits);
  }

  /** Name one tax line (an agency's tax on a row) — null puts the row's own name back. */
  @Patch('transactions/:id/taxes/:agencyId')
  @HttpCode(204)
  async renameTaxLine(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Param('agencyId', ParseIntPipe) agencyId: number,
    @Body() dto: RenameTaxLineDto,
  ): Promise<void> {
    const ok = await this.tax.renameLine(
      scope,
      id,
      agencyId,
      dto.name?.trim() || null,
    );
    if (!ok) throw new NotFoundException('Tax line not found');
  }

  /** Drop the customer's own rule: their rows go back to the default. */
  @Delete('names/rule')
  async resetNameRule(
    @Book() scope: BookScope,
    @Body() dto: ResetNameRuleDto,
  ): Promise<NamesView> {
    await this.nameMemory.resetRule(scope, dto);
    return this.tax.names(scope);
  }

  /** Every item on the customer's receipts, with its category and where that came from. */
  @Get('products')
  products(@Book() scope: BookScope): Promise<ProductView[]> {
    return this.productMemory.products(scope);
  }

  /**
   * Always put this item in this category: saved as the customer's rule, applied to their
   * existing rows of it at once and to every later receipt (`ProductMemoryService`).
   */
  @Put('products/rule')
  async saveProductRule(
    @Book() scope: BookScope,
    @Body() dto: SaveProductRuleDto,
  ): Promise<ProductView[]> {
    await this.productMemory.saveRule(scope, dto.itemKey, dto.category);
    return this.productMemory.products(scope);
  }

  /** Drop the customer's rule: their rows go back to the memory's / the transaction's category. */
  @Delete('products/rule')
  async resetProductRule(
    @Book() scope: BookScope,
    @Body() dto: ResetProductRuleDto,
  ): Promise<ProductView[]> {
    await this.productMemory.resetRule(scope, dto.itemKey);
    return this.productMemory.products(scope);
  }

  /**
   * Receipts, cheques and voice notes. Read and matched to a transaction in the
   * background (free). `transactionId` (a form field) adds them to that transaction.
   */
  @Post('attachments')
  @UseInterceptors(
    FilesInterceptor(
      'files',
      MAX_ATTACHMENTS_PER_REQUEST,
      ATTACHMENT_UPLOAD_OPTIONS,
    ),
  )
  uploadAttachments(
    @Book() scope: BookScope,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('transactionId') rawTransactionId?: string,
  ): Promise<AttachmentView[]> {
    const transactionId = rawTransactionId ? Number(rawTransactionId) : null;
    if (
      transactionId !== null &&
      (!Number.isInteger(transactionId) || transactionId < 1)
    ) {
      throw new BadRequestException('transactionId must be a transaction id');
    }
    return this.attachments.upload(scope, files, transactionId);
  }

  /** Where to text receipts, and whether this customer's texts will be recognised. */
  @Get('intake')
  intake(@Book() scope: BookScope): Promise<IntakeView> {
    return this.attachments.intake(scope);
  }

  @Get('attachments')
  listAttachments(@Book() scope: BookScope): Promise<AttachmentView[]> {
    return this.attachments.list(scope);
  }

  @Get('attachments/:id/file')
  async attachmentFile(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.attachments.file(scope, id);
    res.set({
      'Content-Type': f.mimeType,
      'Content-Length': String(f.size),
      'Content-Disposition': attachment(f.filename, true),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(f.stream);
  }

  @Patch('attachments/:id')
  setAttachmentTransaction(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetAttachmentTransactionDto,
  ): Promise<AttachmentView> {
    return this.attachments.setTransaction(
      scope,
      id,
      dto.transactionId ?? null,
    );
  }

  /** Replace the transaction's splits with the receipt's items. */
  @Post('attachments/:id/apply-items')
  applyAttachmentItems(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AttachmentView> {
    return this.attachments.applyItems(scope, id);
  }

  @Post('attachments/:id/retry')
  retryAttachment(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AttachmentView> {
    return this.attachments.retry(scope, id);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  removeAttachment(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.attachments.remove(scope, id);
  }

  @Post('statements')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, STATEMENT_UPLOAD_OPTIONS),
  )
  upload(
    @Book() scope: BookScope,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<StatementView[]> {
    return this.bookkeeping.upload(scope, files);
  }

  @Get('statements')
  list(@Book() scope: BookScope): Promise<StatementView[]> {
    return this.bookkeeping.list(scope);
  }

  @Get('transactions')
  transactions(
    @Book() scope: BookScope,
    @Query('statementIds') statementIds?: string,
  ): Promise<TransactionView[]> {
    const ids = statementIds
      ? statementIds
          .split(',')
          .map((s) => Number(s))
          .filter((n) => Number.isInteger(n) && n > 0)
      : undefined;
    return this.bookkeeping.transactions(scope, ids);
  }

  @Get('statements/:id/file')
  async file(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.bookkeeping.file(scope, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(f.size),
      'Content-Disposition': attachment(f.filename, true),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(f.stream);
  }

  @Patch('statements/:id/account')
  moveStatement(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveStatementDto,
  ): Promise<StatementView> {
    return this.bookkeeping.moveStatement(scope, id, dto.accountName);
  }

  @Post('statements/:id/retry')
  retry(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StatementView> {
    return this.bookkeeping.retry(scope, id);
  }

  @Delete('statements/:id')
  @HttpCode(204)
  remove(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.bookkeeping.remove(scope, id);
  }

  /** The whole ledger, ALWAYS every statement combined. */
  @Get('export')
  async export(
    @Book() scope: BookScope,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (format !== 'xlsx' && format !== 'pdf') {
      throw new BadRequestException('format must be xlsx or pdf');
    }
    const owner = await this.ownerName(scope);
    const rows = await this.exporter.rowsFor(scope);
    const stamp = new Date().toISOString().slice(0, 10);
    const buf =
      format === 'xlsx'
        ? await this.exporter.excel(rows, owner)
        : await this.exporter.pdf(rows, owner);
    res.set({
      'Content-Type':
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      'Content-Disposition': attachment(`ledger-${stamp}.${format}`),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(buf);
  }

  /** Chart of accounts + income statement for `from…to`; balance sheet as of `to`. */
  @Get('reports')
  reports(
    @Book() scope: BookScope,
    @Query() q: ReportsQueryDto,
  ): Promise<ReportsView> {
    if (q.from && q.to && q.from > q.to) {
      throw new BadRequestException('from must be on or before to');
    }
    return this.reportsService.reports(scope, q.from ?? null, q.to ?? null);
  }

  /** The categories this customer may pick: the fixed chart, then their own. */
  @Get('accounts')
  accountList(@Book() scope: BookScope): Promise<AccountView[]> {
    return this.accounts.list(scope);
  }

  /** A category of the customer's own, for when nothing in the chart fits. */
  @Post('accounts')
  createAccount(
    @Book() scope: BookScope,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountView> {
    return this.accounts.create(scope, dto);
  }

  /**
   * Move an account to another section ("drag it to Liabilities"). Its rows never change;
   * every report, the tax kind and the Names tab read the new type at once.
   */
  @Put('accounts/type')
  @HttpCode(204)
  setAccountType(
    @Book() scope: BookScope,
    @Body() dto: SetAccountTypeDto,
  ): Promise<void> {
    return this.accounts.setType(scope, dto.account, dto.type);
  }

  /** Put a moved account back where the chart (or their own category) puts it. */
  @Delete('accounts/type')
  @HttpCode(204)
  resetAccountType(
    @Book() scope: BookScope,
    @Body() dto: ResetAccountTypeDto,
  ): Promise<void> {
    return this.accounts.resetType(scope, dto.account);
  }

  /** Set the currency of a statement account; its statements are converted from it. */
  @Put('accounts/currency')
  @HttpCode(204)
  setAccountCurrency(
    @Book() scope: BookScope,
    @Body() dto: SetAccountCurrencyDto,
  ): Promise<void> {
    return this.accounts.setCurrency(scope, dto.account, dto.currency);
  }

  /** Back to the currency read off each of the account's statements. */
  @Delete('accounts/currency')
  @HttpCode(204)
  resetAccountCurrency(
    @Book() scope: BookScope,
    @Body() dto: ResetAccountTypeDto,
  ): Promise<void> {
    return this.accounts.resetCurrency(scope, dto.account);
  }

  /** The currency the books are kept in, and the ones we have daily rates for. */
  @Get('currency')
  async currency(
    @Book() scope: BookScope,
  ): Promise<{ home: string; currencies: readonly string[] }> {
    return {
      home: await this.fx.home(scope),
      currencies: this.fx.currencies(),
    };
  }

  /**
   * Change the home currency. Nothing is rewritten: every reader converts on read, so the
   * ledger, reports and exports follow at once.
   */
  @Put('currency')
  async setCurrency(
    @Book() scope: BookScope,
    @Body() dto: SetCurrencyDto,
  ): Promise<{ home: string; currencies: readonly string[] }> {
    return {
      home: await this.fx.setHome(scope, dto.home),
      currencies: this.fx.currencies(),
    };
  }
}
