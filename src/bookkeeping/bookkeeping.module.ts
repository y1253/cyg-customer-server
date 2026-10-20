import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { RulesService } from '../assistant/rules.service';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { AttachmentExtractor } from './attachment-extractor';
import { AttachmentProcessorService } from './attachment-processor.service';
import { AttachmentsService } from './attachments.service';
import { BookScopeGuard } from './book-scope.guard';
import { BookkeepingController } from './bookkeeping.controller';
import { BookkeepingService } from './bookkeeping.service';
import { LedgerExportService } from './export.service';
import { FxService } from './fx.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { ProductCategorizer } from './product-categorizer';
import { ProductMemoryService } from './product-memory.service';
import { ReportsService } from './reports.service';
import { SplitsService } from './splits.service';
import { StaffBookGuard } from './staff-book.guard';
import { StaffRulesController } from './staff-rules.controller';
import { StaffRulesService } from './staff-rules.service';
import { StatementExtractor } from './statement-extractor';
import { StatementImagesService } from './statement-images.service';
import { StatementProcessorService } from './statement-processor.service';
import { TaxService } from './tax.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [BookkeepingController, StaffRulesController],
  providers: [
    AttachmentExtractor,
    AttachmentProcessorService,
    AttachmentsService,
    BookkeepingService,
    BookScopeGuard,
    CustomerAccountsService,
    FxService,
    LedgerExportService,
    NameMemoryService,
    OpenAiClient,
    ProductCategorizer,
    ProductMemoryService,
    ReportsService,
    RulesService,
    SplitsService,
    StaffBookGuard,
    StaffRulesService,
    StatementExtractor,
    StatementImagesService,
    StatementProcessorService,
    TaxService,
  ],
  // The AI assistant (step11) works through the same services the website uses.
  exports: [
    AttachmentProcessorService,
    AttachmentsService,
    BookkeepingService,
    BookScopeGuard,
    CustomerAccountsService,
    NameMemoryService,
    ReportsService,
    RulesService,
    SplitsService,
    TaxService,
  ],
})
export class BookkeepingModule {}
