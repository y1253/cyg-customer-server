import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { BankFeedSyncService } from './bank-feed-sync.service';
import {
  BankFeedsController,
  PlaidWebhookController,
} from './bank-feeds.controller';
import { BankFeedsService } from './bank-feeds.service';
import { BankRowCategorizer } from './bank-row-categorizer';
import { PlaidClient } from './plaid.client';

/** step11 — connect a bank through Plaid instead of uploading statements. */
@Module({
  imports: [CustomerAuthModule, BookkeepingModule],
  controllers: [BankFeedsController, PlaidWebhookController],
  providers: [
    BankFeedSyncService,
    BankFeedsService,
    BankRowCategorizer,
    OpenAiClient,
    PlaidClient,
  ],
})
export class BankFeedsModule {}
