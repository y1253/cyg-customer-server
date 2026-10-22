import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { VoiceModule } from '../voice/voice.module';
import { AiSchedulesService } from './ai-schedules.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

/**
 * step11b: a book's scheduled messages (the Schedules tab). step12: plus the ones the
 * customer asks the AI for (`AiSchedulesService`; rows via `AiSchedulesStore`, which the
 * assistant module provides so its tools can create them).
 */
@Module({
  imports: [
    BookkeepingModule,
    CustomerAuthModule,
    MessagingModule,
    AssistantModule,
    VoiceModule,
  ],
  controllers: [SchedulesController],
  providers: [SchedulesService, AiSchedulesService],
})
export class SchedulesModule {}
