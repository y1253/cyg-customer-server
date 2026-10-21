import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { VoiceCallsService } from './voice-calls.service';
import {
  VoiceRecordingController,
  VoiceStatusController,
} from './voice.controller';
import { VoiceGateway } from './voice.gateway';

/** step12: the AI assistant on the phone (stream bridge, calls, recordings). */
@Module({
  imports: [
    AssistantModule,
    BookkeepingModule,
    CustomerAuthModule,
    MessagingModule,
  ],
  controllers: [VoiceStatusController, VoiceRecordingController],
  providers: [VoiceCallsService, VoiceGateway],
  exports: [VoiceCallsService],
})
export class VoiceModule {}
