export interface LiveCall {
    inject(note: string): void;
}
export declare const liveCalls: {
    addProspect(phoneE164: string, call: LiveCall): void;
    addConversation(conversationId: number, call: LiveCall): void;
    remove(call: LiveCall): void;
    toProspect(phoneE164: string, note: string): boolean;
    toConversation(conversationId: number, note: string): boolean;
};
