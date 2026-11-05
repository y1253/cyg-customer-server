import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
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
  ContactReplyDto,
} from './dto/assistant.dto';
import { IntakeSystemGuard } from '../customer-auth/intake-system.guard';
import { ContactRelayService, type RelayResult } from './contact-relay.service';
import { IntakeAgentGuard, IntakeCustomer } from './intake-agent.guard';
import {
  IntakeAgentService,
  type IntakeReply,
  type IntakeRoute,
} from './intake-agent.service';
import { RulesService, type CustomerRuleView } from './rules.service';
import { changeFeed } from './change-feed';
import { OpenAiClient } from '../ai/openai.client';
import { withAiUsage } from '../ai/ai-usage.context';
import { isHallucinatedTranscript } from '../ai/transcript-hygiene.util';
import {
  MAX_TRANSCRIBE_BYTES,
  transcribeFileFilter,
} from '../ai/transcribe-upload';

/** Is the assistant on? The website hides it when not. */
@Controller('assistant')
@UseGuards(CustomerJwtGuard)
export class AssistantConfigController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('config')
  config(): { enabled: boolean } {
    return { enabled: this.assistant.enabled };
  }

  /**
   * step12h: polled by the open website (every 10 s while visible) — the page refetches
   * when `version` moves (`change-feed.ts`).
   */
  @Get('changes')
  changes(@Req() req: Request & { user: CustomerRequestUser }): {
    version: string;
  } {
    return { version: changeFeed.version(req.user.customerId) };
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
    return this.assistant.chat(
      scope,
      dto.text,
      dto.conversationId,
      dto.attachmentIds ?? [],
    );
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

/**
 * step8: voice dictation for every chat on the site (the mic button in `ChatPanel`) — the
 * recording in, its text out; the text goes into the message box, the customer sends it.
 * The internal app's `POST /ai/transcribe` shape: no steering prompt (a prompt makes
 * near-silence come back as the prompt), and a "Thank you for watching" artefact is
 * answered as silence (`isHallucinatedTranscript`). Costed as TRANSCRIBE for this book.
 */
@Controller('assistant')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class DictationController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly openai: OpenAiClient,
  ) {}

  @Post('transcribe')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_TRANSCRIBE_BYTES, files: 1 },
      fileFilter: transcribeFileFilter,
    }),
  )
  async transcribe(
    @Book() scope: BookScope,
    @UploadedFile()
    file?: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<{ text: string }> {
    if (!this.assistant.enabled) {
      throw new BadRequestException('The assistant is switched off.');
    }
    if (!file) throw new BadRequestException('No recording was uploaded.');
    const text = await withAiUsage({ ...scope, feature: 'TRANSCRIBE' }, () =>
      this.openai.transcribe(
        file.buffer,
        file.originalname || 'dictation.webm',
        file.mimetype,
      ),
    );
    return { text: isHallucinatedTranscript(text) ? '' : text };
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

  /** step11b: every AI message linked to this file, on any channel (kept after a delete). */
  @Get(':id/messages')
  messages(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AssistantMessageView[]> {
    return this.assistant.attachmentMessages(scope, id);
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

/** step8: "Ask AI" about one statement we could not read (Bank feeds). */
@Controller('bookkeeping/statements')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class StatementChatController {
  constructor(private readonly assistant: AssistantService) {}

  @Get(':id/chat')
  thread(@Book() scope: BookScope, @Param('id', ParseIntPipe) id: number) {
    return this.assistant.statementThread(scope, id);
  }

  @Post(':id/chat')
  chat(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachmentChatDto,
  ): Promise<ChatResult> {
    return this.assistant.statementChat(scope, id, dto.text);
  }
}

/**
 * step12c: `/api/intake-system/contact-reply` — called by the INTERNAL API only, for a text /
 * call from a number that is no customer: someone the AI reached for a customer answering.
 */
@Controller('intake-system')
@UseGuards(IntakeSystemGuard)
export class ContactReplyController {
  constructor(private readonly relay: ContactRelayService) {}

  @Post('contact-reply')
  @HttpCode(200)
  contactReply(@Body() dto: ContactReplyDto): Promise<RelayResult> {
    return this.relay.relay(dto);
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
    return this.intake.route(customerId, dto.channel, dto.peer, dto.text);
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
      replyFrom: dto.replyFrom ?? null,
    });
  }
}
