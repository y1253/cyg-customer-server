import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  CustomColumnsService,
  type CustomColumnView,
  type CustomNameAnswerView,
} from './custom-columns.service';
import { CustomNameAnswerDto } from './dto/custom-column.dto';
import {
  NameGroupDto,
  SetNameAgenciesDto,
  SetNameFieldsDto,
  SetNameGroupDto,
  SubNameSettingsDto,
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
import { SubNamesService, type SubNameView } from './sub-names.service';
import {
  TaxService,
  type NamesView,
  type TaxSettingsView,
} from './tax.service';

/**
 * 2026-11-27: everything the customer site's Names tab shows, for the internal Rules tab's
 * name editor — the names (descriptions, group, profile, split-rule picks), the sub-names,
 * the split rules / groups, and the book's own columns with each name's default answer.
 */
export interface StaffNamesFull {
  names: NamesView;
  subNames: SubNameView[];
  tax: TaxSettingsView;
  columns: CustomColumnView[];
  nameAnswers: CustomNameAnswerView[];
}

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
    private readonly columns: CustomColumnsService,
  ) {}

  private async full(staff: StaffBook): Promise<StaffNamesFull> {
    const [names, subNames, tax, columns] = await Promise.all([
      this.tax.names(staff.scope),
      this.subNames.list(staff.scope),
      this.tax.settings(staff.scope),
      this.columns.view(staff.scope),
    ]);
    return {
      names,
      subNames,
      tax,
      columns: columns.columns,
      nameAnswers: columns.nameAnswers,
    };
  }

  /** A staff change to a name's settings: logged, QuickBooks follows, the fresh view back. */
  private async changed(
    staff: StaffBook,
    what: string,
  ): Promise<StaffNamesFull> {
    this.log(staff, what);
    this.qbo.syncSoon(staff.scope.bookId);
    return this.full(staff);
  }

  /** 2026-11-27: the whole Names-tab view, for the internal name editor. */
  @Get('names-full')
  namesFull(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
  ): Promise<StaffNamesFull> {
    return this.full(staff);
  }

  @Put('names/group')
  async setNameGroup(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: SetNameGroupDto,
  ): Promise<StaffNamesFull> {
    await this.tax.setNameGroup(staff.scope, dto.name, dto.group ?? null);
    return this.changed(
      staff,
      `put "${dto.name}" in group ${dto.group ?? '(its category)'}`,
    );
  }

  @Put('names/fields')
  async setNameFields(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: SetNameFieldsDto,
  ): Promise<StaffNamesFull> {
    await this.tax.setNameFields(staff.scope, dto.name, dto.fields);
    return this.changed(staff, `saved the profile of "${dto.name}"`);
  }

  @Post('name-groups')
  async createNameGroup(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: NameGroupDto,
  ): Promise<StaffNamesFull> {
    await this.tax.createNameGroup(staff.scope, dto.name);
    return this.changed(staff, `made the name group "${dto.name}"`);
  }

  @Put('names/agencies')
  async setNameAgencies(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: SetNameAgenciesDto,
  ): Promise<StaffNamesFull> {
    await this.tax.setNameAgencies(
      staff.scope,
      dto.name,
      dto.agencyIds,
      dto.alone === true,
    );
    return this.changed(
      staff,
      `set the split rules of "${dto.name}" to [${dto.agencyIds.join(', ')}]`,
    );
  }

  /**
   * A description (DESCRIPTION) or a "description contains" text (CONTAINS) tied to a name
   * or a sub-name — the customer's own rule path; another name's link is a 409 unless
   * `replace`.
   */
  @Put('names/description-rule')
  async saveDescriptionRule(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: SaveNameRuleDto,
  ): Promise<StaffNamesFull> {
    const { name, category } = await this.accounts.editValues(staff.scope, dto);
    await this.nameMemory.saveRule(staff.scope, {
      matchType: dto.matchType,
      matchKey: dto.matchKey,
      name,
      category,
      scope: 'ALWAYS',
      replace: dto.replace,
      subNameId: dto.subNameId ?? null,
    });
    return this.changed(
      staff,
      `saved ${dto.matchType} rule "${dto.matchKey}" → ${name ?? '—'}`,
    );
  }

  @Delete('names/description-rule')
  async resetDescriptionRule(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Staff() staff: StaffBook,
    @Body() dto: ResetNameRuleDto,
  ): Promise<StaffNamesFull> {
    await this.nameMemory.resetRule(staff.scope, dto);
    return this.changed(
      staff,
      `removed ${dto.matchType} rule "${dto.matchKey}"`,
    );
  }

  @Patch('sub-names/:id/settings')
  async setSubNameSettings(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Param('id', ParseIntPipe) id: number,
    @Staff() staff: StaffBook,
    @Body() dto: SubNameSettingsDto,
  ): Promise<StaffNamesFull> {
    await this.subNames.setSettings(staff.scope, id, dto);
    return this.changed(staff, `changed the settings of sub-name #${id}`);
  }

  /** A name's / sub-name's default answer in one of the book's columns (fills its empty cells). */
  @Put('custom-columns/:id/names')
  async setNameAnswer(
    @Param('companyId', ParseIntPipe) _companyId: number,
    @Param('id', ParseIntPipe) id: number,
    @Staff() staff: StaffBook,
    @Body() dto: CustomNameAnswerDto,
  ): Promise<StaffNamesFull> {
    await this.columns.setNameAnswer(
      staff.scope,
      id,
      { name: dto.name, subNameId: dto.subNameId },
      { value: dto.value ?? null, dropDownId: dto.dropDownId ?? null },
    );
    return this.changed(
      staff,
      `set column #${id}'s default for ${dto.name ?? `sub-name #${dto.subNameId}`}`,
    );
  }

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
