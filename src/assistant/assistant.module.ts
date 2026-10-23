import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { AiContactsModule } from '../ai-contacts/ai-contacts.module';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AiSchedulesStore } from '../schedules/ai-schedules.store';
import {
  AssistantConfigController,
  AssistantController,
  AttachmentChatController,
  ContactReplyController,
  IntakeController,
} from './assistant.controller';
import { ContactRelayService } from './contact-relay.service';
import { AssistantService } from './assistant.service';
import { AssistantTools } from './assistant-tools';
import { CommunicationsHistory } from './communications-history.service';
import { CustomerOutbox } from './customer-outbox.service';
import { IntakeAgentGuard } from './intake-agent.guard';
import { IntakeAgentService } from './intake-agent.service';
import { StrongAiService } from './strong-ai.service';

/**
 * The AI assistant (step11): the website chat, "Ask AI" on unfiled attachments, and the
 * agent behind the receipt numbers. `RulesService` and `InstructionsService` live in
 * `BookkeepingModule`, because every AI step there reads the learned rules and its extra
 * instructions too. step12: `StrongAiService` answers the agent's `report_ai_issue`.
 * step12b: `CommunicationsHistory` (every channel's messages) and `CustomerOutbox`
 * (sending on another channel).
 */
@Module({
  imports: [
    AiContactsModule,
    BookkeepingModule,
    CustomerAuthModule,
    MessagingModule,
  ],
  controllers: [
    AssistantConfigController,
    AssistantController,
    AttachmentChatController,
    ContactReplyController,
    IntakeController,
  ],
  providers: [
    AssistantService,
    AssistantTools,
    AiSchedulesStore,
    CommunicationsHistory,
    ContactRelayService,
    CustomerOutbox,
    IntakeAgentGuard,
    IntakeAgentService,
    OpenAiClient,
    StrongAiService,
  ],
  exports: [
    AssistantService,
    AssistantTools,
    AiSchedulesStore,
    CommunicationsHistory,
    CustomerOutbox,
  ],
})
export class AssistantModule {}
