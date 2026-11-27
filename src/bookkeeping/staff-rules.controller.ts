import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  MergeNamesDto,
  ResetNameRuleDto,
  ResetProductRuleDto,
  SaveNameRuleDto,
  MergeProductsDto,
  SaveProductRuleDto,
} from './dto/agency.dto';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import {
  mergeNamesAndQuickBooks,
  staffNames,
  type StaffNameView,
} from './merge-names';
import { bookLabel } from './scope';
import { Staff, StaffBookGuard, type StaffBook } from './staff-book.guard';
import { StaffRulesService, type StaffRulesView } from './staff-rules.service';
import { SubNamesService } from './sub-names.service';
import { TaxService } from './tax.service';

/**
 * `/api/staff/books/:companyId/rules` — the customer's own rules for one company's book,
 * for the internal app's "Rules" tab (step2). Called ONLY by the internal API, which checks
 * the staff member's access and role and signs a `staff-book` token (`StaffBookGuard`).
 * Saving and removing run the customer's own code paths, so their rows are re-filed now.
 */
@Controller('staff/books/:companyId/rules')
@UseGuards(StaffBookGuard)
export class StaffRulesController {
  private readonly logger = new Logger(StaffRulesController.name);

  constructor(
    private readonly rules: StaffRulesService,
    private readonly accounts: CustomerAccountsService,
    private readonly nameMemory: NameMemoryService,
    private readonly productMemory: ProductMemoryService,
    private readonly qbo: QuickBooksSyncService,
    private readonly tax: TaxService,
    private readonly subNames: SubNamesService,
  ) {}

  /** step11 part 2 (2026-11-26): every name with its sub-names — the Rules tab's drag list. */
  @Get('names-list')
  namesList(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
  ): Promise<StaffNameView[]> {
    return staffNames(this.tax, this.subNames, staff.scope);
  }

  /**
   * step11 part 2: a name / sub-name dragged onto another in the Rules tab — the customer's
   * own merge (`SubNamesService.merge`), then QuickBooks follows (`mergeNamesAndQuickBooks`).
   */
  @Post('names/merge')
  @HttpCode(200)
  async mergeNames(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: MergeNamesDto,
  ): Promise<StaffNameView[]> {
    await mergeNamesAndQuickBooks(this.subNames, this.qbo, staff.scope, dto);
    this.log(
      staff,
      `merged ${dto.from ?? `sub-name #${dto.fromSubNameId}`} into ${dto.into ?? `sub-name #${dto.intoSubNameId}`}`,
    );
    return staffNames(this.tax, this.subNames, staff.scope);
  }

  @Get()
  view(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
  ): Promise<StaffRulesView> {
    return this.rules.view(staff.scope);
  }

  @Put('names')
  async saveNameRule(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: SaveNameRuleDto,
  ): Promise<StaffRulesView> {
    const { name, category } = await this.accounts.editValues(staff.scope, dto);
    // step11.md (2026-11-25): a renamed payee is renamed in QuickBooks too.
    const pushedAs =
      dto.matchType === 'NAME' && name
        ? await this.qbo.pushedPayee(staff.scope, dto.matchKey)
        : null;
    // Staff always edit the saved rule, never a one-time change — and their word moves a
    // description already linked to another name (step2: no RULE_CONFLICT for staff).
    await this.nameMemory.saveRule(staff.scope, {
      matchType: dto.matchType,
      matchKey: dto.matchKey,
      name,
      category,
      scope: 'ALWAYS',
      replace: true,
    });
    this.qbo.renamePayee(staff.scope, pushedAs, name);
    // step11 part 4: a new category (or name) re-files rows — they go to QuickBooks now.
    this.qbo.syncSoon(staff.scope.bookId);
    this.log(staff, `saved ${dto.matchType} rule "${dto.matchKey}"`);
    return this.rules.view(staff.scope);
  }

  @Delete('names')
  async resetNameRule(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: ResetNameRuleDto,
  ): Promise<StaffRulesView> {
    await this.nameMemory.resetRule(staff.scope, dto);
    this.qbo.syncSoon(staff.scope.bookId);
    this.log(staff, `removed ${dto.matchType} rule "${dto.matchKey}"`);
    return this.rules.view(staff.scope);
  }

  @Put('items')
  async saveItemRule(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: SaveProductRuleDto,
  ): Promise<StaffRulesView> {
    await this.productMemory.saveRule(staff.scope, dto.itemKey, dto.category);
    this.log(staff, `saved item rule "${dto.itemKey}"`);
    return this.rules.view(staff.scope);
  }

  /** 2026-11-27: a receipt item dragged onto another in the Rules tab — one product. */
  @Post('items/merge')
  @HttpCode(200)
  async mergeItems(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: MergeProductsDto,
  ): Promise<StaffRulesView> {
    await this.productMemory.mergeItems(staff.scope, dto.from, dto.into);
    this.qbo.syncSoon(staff.scope.bookId);
    this.log(staff, `merged item "${dto.from}" into "${dto.into}"`);
    return this.rules.view(staff.scope);
  }

  @Delete('items')
  async resetItemRule(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: ResetProductRuleDto,
  ): Promise<StaffRulesView> {
    await this.productMemory.resetRule(staff.scope, dto.itemKey);
    this.log(staff, `removed item rule "${dto.itemKey}"`);
    return this.rules.view(staff.scope);
  }

  private log(staff: StaffBook, what: string): void {
    this.logger.log(
      `staff user #${staff.staffUserId} ${what} for ${bookLabel(staff.scope)}`,
    );
  }
}
