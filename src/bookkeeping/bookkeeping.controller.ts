import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
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
  BookkeepingService,
  type StatementView,
  type TransactionView,
} from './bookkeeping.service';
import { CHART_OF_ACCOUNTS, type ChartAccount } from './chart-of-accounts';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { LedgerExportService } from './export.service';
import { ReportsService } from './reports.service';
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
  ) {}

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

  @Get('accounts')
  accounts(): readonly ChartAccount[] {
    return CHART_OF_ACCOUNTS;
  }
}
