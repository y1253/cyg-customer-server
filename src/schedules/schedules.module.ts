import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

/** step11b: a book's scheduled messages (the Schedules tab). */
@Module({
  imports: [
    BookkeepingModule,
    CustomerAuthModule,
    MessagingModule,
    AssistantModule,
  ],
  controllers: [SchedulesController],
  providers: [SchedulesService],
})
export class SchedulesModule {}
