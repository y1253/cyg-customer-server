import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AssistantConfigController,
  AssistantController,
  AttachmentChatController,
  IntakeController,
} from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantTools } from './assistant-tools';
import { IntakeAgentGuard } from './intake-agent.guard';
import { IntakeAgentService } from './intake-agent.service';

/**
 * The AI assistant (step11): the website chat, "Ask AI" on unfiled attachments, and the
 * agent behind the receipt numbers. `RulesService` lives in `BookkeepingModule`, because
 * every AI step there reads the learned rules too.
 */
@Module({
  imports: [BookkeepingModule, CustomerAuthModule, MessagingModule],
  controllers: [
    AssistantConfigController,
    AssistantController,
    AttachmentChatController,
    IntakeController,
  ],
  providers: [
    AssistantService,
    AssistantTools,
    IntakeAgentGuard,
    IntakeAgentService,
    OpenAiClient,
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
