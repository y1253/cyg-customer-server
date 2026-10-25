import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { AssistantModule } from '../assistant/assistant.module';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { BankFeedSyncService } from './bank-feed-sync.service';
import {
  BankFeedsController,
  PlaidWebhookController,
} from './bank-feeds.controller';
import { BankFeedsService } from './bank-feeds.service';
import { BankRowCategorizer } from './bank-row-categorizer';
import { PlaidClient } from './plaid.client';

/**
 * step11 — connect a bank through Plaid instead of uploading statements. 2026-10-25: the
 * customer's transaction alerts go out through the assistant's `CustomerOutbox`.
 */
@Module({
  imports: [
    AssistantModule,
    BookkeepingModule,
    CustomerAuthModule,
    MessagingModule,
  ],
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
