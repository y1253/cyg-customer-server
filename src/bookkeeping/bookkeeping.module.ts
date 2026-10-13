import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { AttachmentExtractor } from './attachment-extractor';
import { AttachmentProcessorService } from './attachment-processor.service';
import { AttachmentsService } from './attachments.service';
import { BookkeepingController } from './bookkeeping.controller';
import { BookkeepingService } from './bookkeeping.service';
import { LedgerExportService } from './export.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { ReportsService } from './reports.service';
import { SplitsService } from './splits.service';
import { StatementExtractor } from './statement-extractor';
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
    LedgerExportService,
    NameMemoryService,
    OpenAiClient,
    ReportsService,
    SplitsService,
    StatementExtractor,
    StatementProcessorService,
    TaxService,
  ],
  exports: [BookkeepingService],
})
export class BookkeepingModule {}
