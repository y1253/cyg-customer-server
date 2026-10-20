import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import { Book, BookScopeGuard } from '../bookkeeping/book-scope.guard';
import type { BookScope } from '../bookkeeping/scope';
import {
  AssistantService,
  type AssistantMessageView,
  type ChatResult,
  type ConversationView,
} from './assistant.service';
import {
  AttachmentChatDto,
  ChatDto,
  IntakeAgentDto,
  IntakeRouteDto,
} from './dto/assistant.dto';
import { IntakeAgentGuard, IntakeCustomer } from './intake-agent.guard';
import {
  IntakeAgentService,
  type IntakeReply,
  type IntakeRoute,
} from './intake-agent.service';
import { RulesService, type CustomerRuleView } from './rules.service';

/** Is the assistant on? The website hides it when not. */
@Controller('assistant')
@UseGuards(CustomerJwtGuard)
export class AssistantConfigController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('config')
  config(): { enabled: boolean } {
    return { enabled: this.assistant.enabled };
  }
}

/**
 * `/api/assistant` — the AI assistant on the website (step11), always on ONE book of the
 * signed-in customer (`?companyId=`, `BookScopeGuard`): its chats on every channel, and the
 * rules it learned for that book.
 */
@Controller('assistant')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly rules: RulesService,
  ) {}

  @Post('chat')
  chat(@Book() scope: BookScope, @Body() dto: ChatDto): Promise<ChatResult> {
    return this.assistant.chat(scope, dto.text, dto.conversationId);
  }

  @Get('conversations')
  conversations(@Book() scope: BookScope): Promise<ConversationView[]> {
    return this.assistant.conversations(scope);
  }

  @Get('conversations/:id/messages')
  messages(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AssistantMessageView[]> {
    return this.assistant.messages(scope, id);
  }

  @Get('rules')
  listRules(@Book() scope: BookScope): Promise<CustomerRuleView[]> {
    return this.rules.listCustomerRules(scope);
  }

  @Delete('rules/:id')
  @HttpCode(200)
  async deleteRule(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    await this.rules.deleteCustomerRule(scope, id);
    return { ok: true };
  }
}

/** "Ask AI" about one attachment we could not file (step11). */
@Controller('bookkeeping/attachments')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class AttachmentChatController {
  constructor(private readonly assistant: AssistantService) {}

  @Get(':id/chat')
  thread(@Book() scope: BookScope, @Param('id', ParseIntPipe) id: number) {
    return this.assistant.attachmentThread(scope, id);
  }

  @Post(':id/chat')
  chat(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachmentChatDto,
  ): Promise<ChatResult> {
    return this.assistant.attachmentChat(scope, id, dto.text);
  }
}

/**
 * `/api/intake` — called by the INTERNAL API only, for a text / WhatsApp a customer sent a
 * receipt number (step11). `IntakeAgentGuard`: an `intake-agent` token naming the customer.
 */
@Controller('intake')
@UseGuards(IntakeAgentGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeAgentService) {}

  @Post('route')
  @HttpCode(200)
  route(
    @IntakeCustomer() customerId: number,
    @Body() dto: IntakeRouteDto,
  ): Promise<IntakeRoute> {
    return this.intake.route(customerId, dto.channel, dto.peer);
  }

  @Post('agent')
  @HttpCode(200)
  agent(
    @IntakeCustomer() customerId: number,
    @Body() dto: IntakeAgentDto,
  ): Promise<IntakeReply> {
    return this.intake.agent(customerId, {
      channel: dto.channel,
      peer: dto.peer,
      text: dto.text ?? null,
      attachmentIds: dto.attachmentIds,
      deliverable: dto.deliverable,
    });
  }
}
