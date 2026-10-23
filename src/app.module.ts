import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AiContactsModule } from './ai-contacts/ai-contacts.module';
import { AiUsageModule } from './ai-usage/ai-usage.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssistantModule } from './assistant/assistant.module';
import { BankFeedsModule } from './bank-feeds/bank-feeds.module';
import { BillingModule } from './billing/billing.module';
import { BookkeepingModule } from './bookkeeping/bookkeeping.module';
import { CommUsageModule } from './comm-usage/comm-usage.module';
import { ContactModule } from './contact/contact.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { SchedulesModule } from './schedules/schedules.module';
import { VoiceModule } from './voice/voice.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AiUsageModule,
    CommUsageModule,
    StorageModule,
    MailModule,
    ContactModule,
    CustomerAuthModule,
    BookkeepingModule,
    BillingModule,
    AiContactsModule,
    AssistantModule,
    BankFeedsModule,
    SchedulesModule,
    VoiceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
