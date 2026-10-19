import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  ResetNameRuleDto,
  ResetProductRuleDto,
  SaveNameRuleDto,
  SaveProductRuleDto,
} from './dto/agency.dto';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import { bookLabel } from './scope';
import { Staff, StaffBookGuard, type StaffBook } from './staff-book.guard';
import { StaffRulesService, type StaffRulesView } from './staff-rules.service';

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
  ) {}

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
    // Staff always edit the saved rule, never a one-time change.
    await this.nameMemory.saveRule(staff.scope, {
      matchType: dto.matchType,
      matchKey: dto.matchKey,
      name,
      category,
      scope: 'ALWAYS',
    });
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
