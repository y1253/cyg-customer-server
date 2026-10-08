import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { BookkeepingController } from './bookkeeping.controller';
import { BookkeepingService } from './bookkeeping.service';
import { LedgerExportService } from './export.service';
import { ReportsService } from './reports.service';
import { StatementExtractor } from './statement-extractor';
import { StatementProcessorService } from './statement-processor.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [BookkeepingController],
  providers: [
    BookkeepingService,
    LedgerExportService,
    OpenAiClient,
    ReportsService,
    StatementExtractor,
    StatementProcessorService,
  ],
})
export class BookkeepingModule {}
