import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import { ACCOUNT_NAMES } from '../bookkeeping/chart-of-accounts';
import { NAME_RULE } from '../bookkeeping/statement-extractor';

/** Rows per request: one short line each. */
const PER_CALL = 100;

export const SYSTEM_PROMPT = `You are a bookkeeper for a small business. Each row below is \
one transaction from the business's bank or credit-card feed. For each row give:
- ${NAME_RULE}
- category: the account it belongs in, from the allowed list only. Money in (amount > 0) is \
usually income or a transfer; money out (amount < 0) usually an expense. A payment to a \
credit card or a transfer between the owner's own accounts is "Transfer Between Accounts" or \
"Credit Card Payment" when those are in the list. "hint" is the bank's own category and only \
a hint. Answer "Uncategorized" when you truly cannot tell.
Return every key you were given, exactly as given.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'name', 'category'],
        properties: {
          key: { type: 'string' },
          name: { type: ['string', 'null'] },
          category: { type: 'string', enum: [...ACCOUNT_NAMES] },
        },
      },
    },
  },
};

export interface RowToCategorize {
  key: string;
  description: string;
  merchant: string | null;
  /** Our sign: > 0 money in. */
  amount: number;
  hint: string | null;
}

/**
 * Names and categorizes bank-feed rows — only the ones neither the customer's rules nor
 * the firm memories know (`BankFeedSyncService`). Text only, small, the receipt-item
 * categorizer's model. The answers go through `NameMemoryService.resolveStatement` like a
 * statement's, so the memories learn them.
 */
@Injectable()
export class BankRowCategorizer {
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

  /** `key` → the AI's name + category. A key it left out or invented is dropped. */
  async categorize(
    rows: readonly RowToCategorize[],
    rules = '',
  ): Promise<Map<string, { name: string | null; category: string }>> {
    const out = new Map<string, { name: string | null; category: string }>();
    const wanted = new Set(rows.map((r) => r.key));
    for (let i = 0; i < rows.length; i += PER_CALL) {
      const batch = rows.slice(i, i + PER_CALL);
      const reply = await this.openai.chat({
        model: this.model(),
        system: SYSTEM_PROMPT + rules,
        user: `Rows:\n${JSON.stringify(batch)}`,
        jsonSchema: { name: 'bank_rows', schema: SCHEMA },
        maxTokens: 80 * batch.length + 200,
        timeoutMs: 90_000,
      });
      const parsed = JSON.parse(reply) as {
        rows?: Array<{ key?: string; name?: string | null; category?: string }>;
      };
      for (const a of parsed.rows ?? []) {
        if (a.key && a.category && wanted.has(a.key)) {
          out.set(a.key, {
            name: a.name?.trim() || null,
            category: a.category,
          });
        }
      }
    }
    return out;
  }
}
