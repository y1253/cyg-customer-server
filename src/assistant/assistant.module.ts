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
import { StrongAiService } from './strong-ai.service';

/**
 * The AI assistant (step11): the website chat, "Ask AI" on unfiled attachments, and the
 * agent behind the receipt numbers. `RulesService` and `InstructionsService` live in
 * `BookkeepingModule`, because every AI step there reads the learned rules and its extra
 * instructions too. step12: `StrongAiService` answers the agent's `report_ai_issue`.
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
    StrongAiService,
  ],
  exports: [AssistantService, AssistantTools],
})
export class AssistantModule {}
