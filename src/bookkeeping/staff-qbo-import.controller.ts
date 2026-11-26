import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Allow } from 'class-validator';
import { QboImportService, type ImportResult } from './qbo-import.service';
import type { ImportAnalysis } from './qbo-import.util';
import { Staff, StaffBookGuard, type StaffBook } from './staff-book.guard';

/**
 * The bodies are big, nested and built by the internal API (never a browser), so they are
 * taken whole (`@Allow`) and cleaned field by field in the service (`cleanTxns`,
 * `cleanPlan`) — the global `whitelist` pipe would otherwise strip them.
 */
class AnalyzeImportDto {
  @Allow() since?: unknown;
  @Allow() txns?: unknown;
}

class ApplyImportDto {
  @Allow() plan?: unknown;
}

/**
 * step11.md (2026-11-25) — `/api/staff/books/:companyId/qbo-import`: the QuickBooks history
 * import's two steps on the customer side, for the internal API only (`StaffBookGuard`,
 * writes need `canEdit`). `analyze` proposes rules from the QuickBooks transactions it is
 * sent; `apply` makes the rules the admin agreed to.
 */
@Controller('staff/books/:companyId/qbo-import')
@UseGuards(StaffBookGuard)
export class StaffQboImportController {
  constructor(private readonly imports: QboImportService) {}

  @Post('analyze')
  analyze(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: AnalyzeImportDto,
  ): Promise<ImportAnalysis> {
    return this.imports.analyze(staff.scope, dto);
  }

  @Post('apply')
  apply(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: ApplyImportDto,
  ): Promise<ImportResult> {
    return this.imports.apply(staff.scope, dto.plan);
  }
}
