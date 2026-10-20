export declare class ChatDto {
    conversationId?: number;
    text: string;
}
export declare class AttachmentChatDto {
    text: string;
}
export declare class IntakeRouteDto {
    channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
    peer: string;
}
export declare class IntakeAgentDto extends IntakeRouteDto {
    text?: string | null;
    attachmentIds: number[];
    deliverable?: boolean;
}
