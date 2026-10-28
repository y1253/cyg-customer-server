/**
 * step12h: the AI phone calls going on RIGHT NOW, so something that happens elsewhere can
 * reach the agent while it is still talking:
 *
 * - a text the caller sends to the number they are on the phone with (a prospect texting
 *   their email while the salesperson talks),
 * - the strong AI's result for a complaint made on the call (it used to be dropped once the
 *   call went on — customer 43, 2026-10-27).
 *
 * In memory, which is safe because pm2 runs the API in fork mode (one process). Plain module
 * with no imports, so the assistant and sales modules can use it without depending on the
 * voice module.
 */

export interface LiveCall {
  /** Hands the agent a note it reacts to at once (queued while it is speaking). */
  inject(note: string): void;
}

const prospects = new Map<string, LiveCall>();
const conversations = new Map<number, LiveCall>();

export const liveCalls = {
  /** A prospect (no account) on the phone, by their E.164 number. */
  addProspect(phoneE164: string, call: LiveCall): void {
    prospects.set(phoneE164, call);
  },
  /** A customer's call, by its VOICE `AiConversation`. */
  addConversation(conversationId: number, call: LiveCall): void {
    conversations.set(conversationId, call);
  },
  /** Forgets this call (only if it is still the registered one). */
  remove(call: LiveCall): void {
    for (const [k, v] of prospects) if (v === call) prospects.delete(k);
    for (const [k, v] of conversations) if (v === call) conversations.delete(k);
  },
  /** Delivers the note to the prospect's live call; false when they are not on the phone. */
  toProspect(phoneE164: string, note: string): boolean {
    const call = prospects.get(phoneE164);
    if (!call) return false;
    call.inject(note);
    return true;
  },
  /** Delivers the note to the conversation's live call; false when it has ended. */
  toConversation(conversationId: number, note: string): boolean {
    const call = conversations.get(conversationId);
    if (!call) return false;
    call.inject(note);
    return true;
  },
};
