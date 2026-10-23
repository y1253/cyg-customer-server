export declare class ChatDto {
    conversationId?: number;
    text: string;
    attachmentIds?: number[];
}
export declare class AttachmentChatDto {
    text: string;
}
export declare class IntakeRouteDto {
    channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
    peer: string;
    text?: string | null;
}
export declare class IntakeAgentDto extends IntakeRouteDto {
    attachmentIds: number[];
    deliverable?: boolean;
    replyFrom?: string | null;
}
export declare class ContactReplyDto {
    channel: 'SMS' | 'WHATSAPP' | 'CALL';
    phone: string;
    text?: string | null;
}
