import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssistantModule } from './assistant/assistant.module';
import { BankFeedsModule } from './bank-feeds/bank-feeds.module';
import { BillingModule } from './billing/billing.module';
import { BookkeepingModule } from './bookkeeping/bookkeeping.module';
import { ContactModule } from './contact/contact.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { SchedulesModule } from './schedules/schedules.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    MailModule,
    ContactModule,
    CustomerAuthModule,
    BookkeepingModule,
    BillingModule,
    AssistantModule,
    BankFeedsModule,
    SchedulesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
