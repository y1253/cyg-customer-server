"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveCalls = void 0;
const prospects = new Map();
const conversations = new Map();
exports.liveCalls = {
    addProspect(phoneE164, call) {
        prospects.set(phoneE164, call);
    },
    addConversation(conversationId, call) {
        conversations.set(conversationId, call);
    },
    remove(call) {
        for (const [k, v] of prospects)
            if (v === call)
                prospects.delete(k);
        for (const [k, v] of conversations)
            if (v === call)
                conversations.delete(k);
    },
    toProspect(phoneE164, note) {
        const call = prospects.get(phoneE164);
        if (!call)
            return false;
        call.inject(note);
        return true;
    },
    toConversation(conversationId, note) {
        const call = conversations.get(conversationId);
        if (!call)
            return false;
        call.inject(note);
        return true;
    },
};
//# sourceMappingURL=live-calls.js.map