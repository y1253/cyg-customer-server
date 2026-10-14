import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import { ACCOUNT_NAMES } from './chart-of-accounts';

/** Items per request: one short line each, so a whole receipt always fits. */
const PER_CALL = 100;

const SYSTEM_PROMPT = `You are a bookkeeper for a small business. Each item below is one line \
from a purchase receipt the business paid for. Choose the expense account each item belongs \
in, from the allowed list only. Judge by what the item IS (diapers, paper towels and cleaning \
products are Supplies; a printer cartridge is Office Expense; food at a restaurant is \
Meals & Entertainment; gas is Vehicle & Fuel; goods bought to resell are Cost of Goods Sold). \
The store and the transaction's own category are hints only. Answer "Uncategorized" when \
you truly cannot tell. Return every key you were given, exactly as given.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'category'],
        properties: {
          key: { type: 'string' },
          category: { type: 'string', enum: [...ACCOUNT_NAMES] },
        },
      },
    },
  },
};

/**
 * Asks the AI which chart account receipt items go in — only for items neither the
 * customer's rule nor the firm memory knows (`ProductMemoryService`). Text only, small.
 */
@Injectable()
export class ProductCategorizer {
  constructor(
    private readonly openai: OpenAiClient,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return this.openai.configured;
  }

  private model(): string {
    return (
      this.config.get<string>('OPENAI_BOOKKEEPING_TAX_MODEL')?.trim() ||
      'gpt-4.1-mini'
    );
  }

  /** `key` → the AI's category. A key it left out or invented is dropped. */
  async categorize(
    items: ReadonlyArray<{ key: string; name: string }>,
    context: { store?: string | null; category?: string | null } = {},
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const wanted = new Set(items.map((i) => i.key));
    for (let i = 0; i < items.length; i += PER_CALL) {
      const batch = items.slice(i, i + PER_CALL);
      const reply = await this.openai.chat({
        model: this.model(),
        system: SYSTEM_PROMPT,
        user:
          `Store: ${context.store ?? 'unknown'}\n` +
          `Transaction category: ${context.category ?? 'unknown'}\n\n` +
          `Items:\n${JSON.stringify(batch)}`,
        jsonSchema: { name: 'product_categories', schema: SCHEMA },
        maxTokens: 60 * batch.length + 200,
        timeoutMs: 60_000,
      });
      const parsed = JSON.parse(reply) as {
        items?: Array<{ key?: string; category?: string }>;
      };
      for (const a of parsed.items ?? []) {
        if (a.key && a.category && wanted.has(a.key))
          out.set(a.key, a.category);
      }
    }
    return out;
  }
}
