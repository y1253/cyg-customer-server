import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/** step12f: the AI salesperson for phones with no account (texts here, calls in `voice`). */
@Module({
  imports: [BookkeepingModule, CustomerAuthModule, MessagingModule],
  controllers: [SalesController],
  providers: [SalesService, OpenAiClient],
  exports: [SalesService],
})
export class SalesModule {}
