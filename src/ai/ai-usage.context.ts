import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * step12: AI cost tracking — WHO an OpenAI call is for. Set once where the work starts (a
 * chat message, a statement being read, a schedule firing…) and read by `OpenAiClient`
 * when it records the call's usage, so the ~10 call sites never pass the customer down.
 *
 * ⚠️ Any new OpenAI call must run inside `withAiUsage`, or its cost is filed under no
 * customer ("OTHER").
 */
export type AiFeature =
  | 'ASSISTANT'
  | 'STRONG_AI'
  | 'INTAKE'
  | 'STATEMENT'
  | 'ATTACHMENT'
  | 'TRANSCRIBE'
  | 'PRODUCTS'
  | 'BANK_ROWS'
  | 'VOICE'
  | 'SCHEDULE'
  | 'OTHER';

export interface AiUsageContext {
  customerId: number | null;
  /** step12c: the book the call worked on. */
  bookId: number | null;
  companyId: number | null;
  feature: AiFeature;
}

const storage = new AsyncLocalStorage<AiUsageContext>();

/**
 * Runs `fn` with this context. Fields left out are kept from the outer context, so a
 * nested step can change only the feature (a transcription inside an attachment read).
 */
export function withAiUsage<T>(
  ctx: Partial<AiUsageContext> & { feature: AiFeature },
  fn: () => T,
): T {
  const outer = storage.getStore();
  return storage.run(
    {
      customerId:
        ctx.customerId !== undefined
          ? ctx.customerId
          : (outer?.customerId ?? null),
      bookId:
        ctx.bookId !== undefined ? ctx.bookId : (outer?.bookId ?? null),
      companyId:
        ctx.companyId !== undefined
          ? ctx.companyId
          : (outer?.companyId ?? null),
      feature: ctx.feature,
    },
    fn,
  );
}

/** The current context; none = system work. */
export function currentAiUsage(): AiUsageContext {
  return (
    storage.getStore() ?? {
      customerId: null,
      bookId: null,
      companyId: null,
      feature: 'OTHER',
    }
  );
}
