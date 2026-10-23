import type { BookScope } from '../bookkeeping/scope';
import { AssistantService, type AssistantMessageView, type ChatResult, type ConversationView } from './assistant.service';
import { AttachmentChatDto, ChatDto, IntakeAgentDto, IntakeRouteDto, ContactReplyDto } from './dto/assistant.dto';
import { ContactRelayService, type RelayResult } from './contact-relay.service';
import { IntakeAgentService, type IntakeReply, type IntakeRoute } from './intake-agent.service';
import { RulesService, type CustomerRuleView } from './rules.service';
export declare class AssistantConfigController {
    private readonly assistant;
    constructor(assistant: AssistantService);
    config(): {
        enabled: boolean;
    };
}
export declare class AssistantController {
    private readonly assistant;
    private readonly rules;
    constructor(assistant: AssistantService, rules: RulesService);
    chat(scope: BookScope, dto: ChatDto): Promise<ChatResult>;
    conversations(scope: BookScope): Promise<ConversationView[]>;
    messages(scope: BookScope, id: number): Promise<AssistantMessageView[]>;
    listRules(scope: BookScope): Promise<CustomerRuleView[]>;
    deleteRule(scope: BookScope, id: number): Promise<{
        ok: true;
    }>;
}
export declare class AttachmentChatController {
    private readonly assistant;
    constructor(assistant: AssistantService);
    thread(scope: BookScope, id: number): Promise<{
        conversationId: number | null;
        messages: AssistantMessageView[];
    }>;
    messages(scope: BookScope, id: number): Promise<AssistantMessageView[]>;
    chat(scope: BookScope, id: number, dto: AttachmentChatDto): Promise<ChatResult>;
}
export declare class ContactReplyController {
    private readonly relay;
    constructor(relay: ContactRelayService);
    contactReply(dto: ContactReplyDto): Promise<RelayResult>;
}
export declare class IntakeController {
    private readonly intake;
    constructor(intake: IntakeAgentService);
    route(customerId: number, dto: IntakeRouteDto): Promise<IntakeRoute>;
    agent(customerId: number, dto: IntakeAgentDto): Promise<IntakeReply>;
}
