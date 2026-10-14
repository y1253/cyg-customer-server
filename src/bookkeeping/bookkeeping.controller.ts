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
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CustomerAuthService } from '../customer-auth/customer-auth.service';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
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
  RenameTaxLineDto,
  ResetNameRuleDto,
  ResetProductRuleDto,
  SaveSplitsDto,
  SaveNameRuleDto,
  SaveProductRuleDto,
  SetAttachmentTransactionDto,
  UpdateAgencyDto,
  UpdateNameDto,
  UpdateTaxDto,
} from './dto/agency.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { LedgerExportService } from './export.service';
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

type AuthedRequest = Request & { user: CustomerRequestUser };

/** RFC 5987 filename for Content-Disposition, safe for any characters. */
function attachment(filename: string, inline = false): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** `/api/bookkeeping` — every route needs a signed-in customer and acts only on their data. */
@Controller('bookkeeping')
@UseGuards(CustomerJwtGuard)
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
  ) {}

  /**
   * Reads every UPLOADED statement and re-applies changed tax settings — only when it is
   * free (402 otherwise; a paid Generate is `POST /billing/checkout`).
   */
  @Post('generate')
  generate(
    @Req() req: AuthedRequest,
  ): Promise<{ queued: number; taxing: boolean }> {
    return this.bookkeeping.generateIfFree(req.user.customerId);
  }

  @Get('tax')
  taxSettings(@Req() req: AuthedRequest): Promise<TaxSettingsView> {
    return this.tax.settings(req.user.customerId);
  }

  @Patch('tax')
  setTax(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateTaxDto,
  ): Promise<TaxSettingsView> {
    return this.tax.setEnabled(req.user.customerId, dto.enabled);
  }

  @Post('agencies')
  createAgency(
    @Req() req: AuthedRequest,
    @Body() dto: CreateAgencyDto,
  ): Promise<AgencyView> {
    return this.tax.createAgency(req.user.customerId, dto);
  }

  @Patch('agencies/:id')
  updateAgency(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAgencyDto,
  ): Promise<AgencyView> {
    return this.tax.updateAgency(req.user.customerId, id, dto);
  }

  @Delete('agencies/:id')
  @HttpCode(204)
  removeAgency(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.tax.removeAgency(req.user.customerId, id);
  }

  /** Every payee name the AI read (category, type, tax switch, rule) plus the unnamed rows. */
  @Get('names')
  names(@Req() req: AuthedRequest): Promise<NamesView> {
    return this.tax.names(req.user.customerId);
  }

  @Patch('names')
  updateName(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateNameDto,
  ): Promise<NamesView> {
    return this.tax.setNameTax(req.user.customerId, dto.name, dto.taxExempt);
  }

  /**
   * Save the customer's own name and/or category. Applied to their existing rows at once
   * and to every statement they read from now on (`NameMemoryService`).
   */
  @Put('names/rule')
  async saveNameRule(
    @Req() req: AuthedRequest,
    @Body() dto: SaveNameRuleDto,
  ): Promise<NamesView> {
    const { name, category } = await this.editValues(req.user.customerId, dto);
    await this.nameMemory.saveRule(req.user.customerId, {
      matchType: dto.matchType,
      matchKey: dto.matchKey,
      name,
      category,
      scope: dto.scope ?? 'ALWAYS',
    });
    return this.tax.names(req.user.customerId);
  }

  /**
   * Change ONE ledger row's name and/or category: just that row (`ONCE`), or saved for its
   * payee from now on (`ALWAYS`, the same rule the Names tab saves).
   */
  @Patch('transactions/:id')
  @HttpCode(204)
  async editTransaction(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditTransactionDto,
  ): Promise<void> {
    const { name, category } = await this.editValues(req.user.customerId, dto);
    await this.nameMemory.editTransaction(req.user.customerId, id, {
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
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveSplitsDto,
  ): Promise<void> {
    return this.splits.save(req.user.customerId, id, dto.splits);
  }

  /** Name one tax line (an agency's tax on a row) — null puts the row's own name back. */
  @Patch('transactions/:id/taxes/:agencyId')
  @HttpCode(204)
  async renameTaxLine(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('agencyId', ParseIntPipe) agencyId: number,
    @Body() dto: RenameTaxLineDto,
  ): Promise<void> {
    const ok = await this.tax.renameLine(
      req.user.customerId,
      id,
      agencyId,
      dto.name?.trim() || null,
    );
    if (!ok) throw new NotFoundException('Tax line not found');
  }

  /** A name and/or a category the customer may use — the chart or one of their own. */
  private async editValues(
    customerId: number,
    dto: { name?: string | null; category?: string | null },
  ): Promise<{ name: string | null; category: string | null }> {
    const name = dto.name?.trim() || null;
    const raw = dto.category?.trim() || null;
    if (!name && !raw) {
      throw new BadRequestException('Enter a name or choose a category');
    }
    const category = raw
      ? await this.accounts.validCategory(customerId, raw)
      : null;
    return { name, category };
  }

  /** Drop the customer's own rule: their rows go back to the default. */
  @Delete('names/rule')
  async resetNameRule(
    @Req() req: AuthedRequest,
    @Body() dto: ResetNameRuleDto,
  ): Promise<NamesView> {
    await this.nameMemory.resetRule(req.user.customerId, dto);
    return this.tax.names(req.user.customerId);
  }

  /** Every item on the customer's receipts, with its category and where that came from. */
  @Get('products')
  products(@Req() req: AuthedRequest): Promise<ProductView[]> {
    return this.productMemory.products(req.user.customerId);
  }

  /**
   * Always put this item in this category: saved as the customer's rule, applied to their
   * existing rows of it at once and to every later receipt (`ProductMemoryService`).
   */
  @Put('products/rule')
  async saveProductRule(
    @Req() req: AuthedRequest,
    @Body() dto: SaveProductRuleDto,
  ): Promise<ProductView[]> {
    await this.productMemory.saveRule(
      req.user.customerId,
      dto.itemKey,
      dto.category,
    );
    return this.productMemory.products(req.user.customerId);
  }

  /** Drop the customer's rule: their rows go back to the memory's / the transaction's category. */
  @Delete('products/rule')
  async resetProductRule(
    @Req() req: AuthedRequest,
    @Body() dto: ResetProductRuleDto,
  ): Promise<ProductView[]> {
    await this.productMemory.resetRule(req.user.customerId, dto.itemKey);
    return this.productMemory.products(req.user.customerId);
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
    @Req() req: AuthedRequest,
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
    return this.attachments.upload(req.user.customerId, files, transactionId);
  }

  /** Where to text receipts, and whether this customer's texts will be recognised. */
  @Get('intake')
  intake(@Req() req: AuthedRequest): Promise<IntakeView> {
    return this.attachments.intake(req.user.customerId);
  }

  @Get('attachments')
  listAttachments(@Req() req: AuthedRequest): Promise<AttachmentView[]> {
    return this.attachments.list(req.user.customerId);
  }

  @Get('attachments/:id/file')
  async attachmentFile(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.attachments.file(req.user.customerId, id);
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
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetAttachmentTransactionDto,
  ): Promise<AttachmentView> {
    return this.attachments.setTransaction(
      req.user.customerId,
      id,
      dto.transactionId ?? null,
    );
  }

  /** Replace the transaction's splits with the receipt's items. */
  @Post('attachments/:id/apply-items')
  applyAttachmentItems(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AttachmentView> {
    return this.attachments.applyItems(req.user.customerId, id);
  }

  @Post('attachments/:id/retry')
  retryAttachment(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AttachmentView> {
    return this.attachments.retry(req.user.customerId, id);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  removeAttachment(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.attachments.remove(req.user.customerId, id);
  }

  @Post('statements')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, STATEMENT_UPLOAD_OPTIONS),
  )
  upload(
    @Req() req: AuthedRequest,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<StatementView[]> {
    return this.bookkeeping.upload(req.user.customerId, files);
  }

  @Get('statements')
  list(@Req() req: AuthedRequest): Promise<StatementView[]> {
    return this.bookkeeping.list(req.user.customerId);
  }

  @Get('transactions')
  transactions(
    @Req() req: AuthedRequest,
    @Query('statementIds') statementIds?: string,
  ): Promise<TransactionView[]> {
    const ids = statementIds
      ? statementIds
          .split(',')
          .map((s) => Number(s))
          .filter((n) => Number.isInteger(n) && n > 0)
      : undefined;
    return this.bookkeeping.transactions(req.user.customerId, ids);
  }

  @Get('statements/:id/file')
  async file(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.bookkeeping.file(req.user.customerId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(f.size),
      'Content-Disposition': attachment(f.filename, true),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(f.stream);
  }

  @Post('statements/:id/retry')
  retry(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StatementView> {
    return this.bookkeeping.retry(req.user.customerId, id);
  }

  @Delete('statements/:id')
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.bookkeeping.remove(req.user.customerId, id);
  }

  /** The whole ledger, ALWAYS every statement combined. */
  @Get('export')
  async export(
    @Req() req: AuthedRequest,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (format !== 'xlsx' && format !== 'pdf') {
      throw new BadRequestException('format must be xlsx or pdf');
    }
    const me = await this.customers.me(req.user.customerId);
    const rows = await this.exporter.rowsFor(req.user.customerId);
    const stamp = new Date().toISOString().slice(0, 10);
    const buf =
      format === 'xlsx'
        ? await this.exporter.excel(rows, me.name)
        : await this.exporter.pdf(rows, me.name);
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
    @Req() req: AuthedRequest,
    @Query() q: ReportsQueryDto,
  ): Promise<ReportsView> {
    if (q.from && q.to && q.from > q.to) {
      throw new BadRequestException('from must be on or before to');
    }
    return this.reportsService.reports(
      req.user.customerId,
      q.from ?? null,
      q.to ?? null,
    );
  }

  /** The categories this customer may pick: the fixed chart, then their own. */
  @Get('accounts')
  accountList(@Req() req: AuthedRequest): Promise<AccountView[]> {
    return this.accounts.list(req.user.customerId);
  }

  /** A category of the customer's own, for when nothing in the chart fits. */
  @Post('accounts')
  createAccount(
    @Req() req: AuthedRequest,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountView> {
    return this.accounts.create(req.user.customerId, dto);
  }
}
