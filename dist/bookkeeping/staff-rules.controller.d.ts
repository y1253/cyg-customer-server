import { CustomerAccountsService } from './customer-accounts.service';
import { ResetNameRuleDto, ResetProductRuleDto, SaveNameRuleDto, SaveProductRuleDto } from './dto/agency.dto';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import { type StaffBook } from './staff-book.guard';
import { StaffRulesService, type StaffRulesView } from './staff-rules.service';
export declare class StaffRulesController {
    private readonly rules;
    private readonly accounts;
    private readonly nameMemory;
    private readonly productMemory;
    private readonly logger;
    constructor(rules: StaffRulesService, accounts: CustomerAccountsService, nameMemory: NameMemoryService, productMemory: ProductMemoryService);
    view(_companyId: number, staff: StaffBook): Promise<StaffRulesView>;
    saveNameRule(_companyId: number, staff: StaffBook, dto: SaveNameRuleDto): Promise<StaffRulesView>;
    resetNameRule(_companyId: number, staff: StaffBook, dto: ResetNameRuleDto): Promise<StaffRulesView>;
    saveItemRule(_companyId: number, staff: StaffBook, dto: SaveProductRuleDto): Promise<StaffRulesView>;
    resetItemRule(_companyId: number, staff: StaffBook, dto: ResetProductRuleDto): Promise<StaffRulesView>;
    private log;
}
