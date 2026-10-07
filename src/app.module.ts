import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BookkeepingModule } from './bookkeeping/bookkeeping.module';
import { ContactModule } from './contact/contact.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
