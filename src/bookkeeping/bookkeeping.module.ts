import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { AttachmentExtractor } from './attachment-extractor';
import { AttachmentProcessorService } from './attachment-processor.service';
import { AttachmentsService } from './attachments.service';
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
import { StatementExtractor } from './statement-extractor';
import { StatementImagesService } from './statement-images.service';
import { StatementProcessorService } from './statement-processor.service';
import { TaxService } from './tax.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [BookkeepingController],
  providers: [
    AttachmentExtractor,
    AttachmentProcessorService,
    AttachmentsService,
    BookkeepingService,
    CustomerAccountsService,
    FxService,
    LedgerExportService,
    NameMemoryService,
    OpenAiClient,
    ProductCategorizer,
    ProductMemoryService,
    ReportsService,
    SplitsService,
    StatementExtractor,
    StatementImagesService,
    StatementProcessorService,
    TaxService,
  ],
  exports: [BookkeepingService],
})
export class BookkeepingModule {}
