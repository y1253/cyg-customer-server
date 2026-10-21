import { agentBody } from '../ai/openai.client';
import {
  bookQuestion,
  channelStyle,
  bookCandidates,
  isSwitchRequest,
  parseBookChoice,
  systemPrompt,
  whichBookQuestion,
} from './assistant-prompt';
import {
  cleanRuleText,
  MAX_RULES_IN_PROMPT,
  ruleKey,
  rulesBlock,
} from './rules.util';
import { filterTransactions, type LedgerRow } from './transaction-filter.util';

describe('rulesBlock', () => {
  it('is empty with no rules', () => {
    expect(rulesBlock([])).toBe('');
  });

  it("puts the book's own rules first and drops reworded duplicates", () => {
    const block = rulesBlock([
      {
        text: 'Amazon receipts match AMZN MKTP charges.',
        topic: 'MATCHING',
        global: true,
      },
      {
        text: 'Rent is paid to Smith Holdings',
        topic: 'NAMING',
        global: false,
      },
      {
        text: 'amazon receipts match amzn mktp charges',
        topic: 'MATCHING',
        global: false,
      },
    ]);
    const lines = block.trim().split('\n').slice(1);
    expect(lines).toEqual([
      '1. Rent is paid to Smith Holdings',
      '2. amazon receipts match amzn mktp charges',
    ]);
  });

  it('keeps only the topic asked for, plus GENERAL', () => {
    const block = rulesBlock(
      [
        { text: 'a match rule', topic: 'MATCHING', global: true },
        { text: 'a category rule', topic: 'CATEGORY', global: true },
        { text: 'a general rule', topic: 'GENERAL', global: true },
      ],
      'CATEGORY',
    );
    expect(block).toContain('a category rule');
    expect(block).toContain('a general rule');
    expect(block).not.toContain('a match rule');
  });

  it('stops at the cap', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      text: `rule number ${i}`,
      topic: 'GENERAL',
      global: true,
    }));
    const lines = rulesBlock(many).trim().split('\n').slice(1);
    expect(lines).toHaveLength(MAX_RULES_IN_PROMPT);
  });

  it('cleans and keys rule text', () => {
    expect(cleanRuleText('  two\n lines ')).toBe('two lines');
    expect(cleanRuleText('   ')).toBeNull();
    expect(ruleKey('Café — Rent!')).toBe(ruleKey('cafe rent'));
  });
});

describe('filterTransactions', () => {
  const row = (id: number, extra: Partial<LedgerRow>): LedgerRow => ({
    id,
    postingDate: '2026-03-10',
    pendingDate: null,
    description: 'POS',
    name: null,
    amount: -10,
    offsetAccount: 'Supplies',
    statementLabel: 'TD · Mar 2026',
    ...extra,
  });
  const rows = [
    row(1, { name: 'Costco', amount: -100, postingDate: '2026-03-02' }),
    row(2, { name: 'Costco', amount: -50, postingDate: '2026-04-02' }),
    row(3, {
      name: 'Client A',
      amount: 500,
      offsetAccount: 'Sales',
      postingDate: '2026-03-20',
    }),
    row(4, { kind: 'opening', amount: 1000, postingDate: '2026-03-01' }),
    row(5, {
      kind: 'split',
      name: 'Costco',
      itemName: 'Paper',
      amount: -20,
      postingDate: '2026-03-02',
    }),
  ];

  it('filters by month, newest first, and leaves out starting balances', () => {
    const r = filterTransactions(rows, {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(r.rows.map((x) => x.id)).toEqual([3, 1, 5]);
    expect(r.count).toBe(3);
  });

  it('totals ALL matches even past the limit', () => {
    const r = filterTransactions(rows, { name: 'costco', limit: 1 });
    expect(r.count).toBe(3);
    expect(r.total).toBe(-170);
    expect(r.rows).toHaveLength(1);
  });

  it('filters by category, direction and amount', () => {
    expect(
      filterTransactions(rows, { direction: 'in' }).rows.map((x) => x.id),
    ).toEqual([3]);
    expect(filterTransactions(rows, { category: 'sales' }).count).toBe(1);
    expect(
      filterTransactions(rows, { minAmount: 60 }).rows.map((x) => x.id),
    ).toEqual([3, 1]);
  });
});

describe('book choice', () => {
  const options = [
    { companyId: null, name: 'Personal' },
    { companyId: 3, name: 'ABC Inc' },
    { companyId: 4, name: 'Bakery Ltd' },
  ];

  it('asks with numbered choices', () => {
    expect(bookQuestion(options)).toContain(
      '1 Personal, 2 ABC Inc, 3 Bakery Ltd',
    );
  });

  it('reads a number, a name, a word of a name, or "personal"', () => {
    expect(parseBookChoice('2', options)?.companyId).toBe(3);
    expect(parseBookChoice('#3', options)?.companyId).toBe(4);
    expect(parseBookChoice('abc inc', options)?.companyId).toBe(3);
    expect(parseBookChoice('bakery', options)?.companyId).toBe(4);
    expect(parseBookChoice('personal', options)?.companyId).toBeNull();
    expect(parseBookChoice('switch to bakery', options)?.companyId).toBe(4);
  });

  it('reads a switch in ordinary words (step11b)', () => {
    const books = [
      { companyId: null, name: 'Personal' },
      { companyId: 3, name: 'ABC Construction Inc.' },
      { companyId: 4, name: 'ABC Bakery' },
    ];
    expect(isSwitchRequest('can you switch to ABC Construction please')).toBe(
      true,
    );
    expect(isSwitchRequest('this is for personal')).toBe(true);
    expect(isSwitchRequest('move it to book 2')).toBe(true);
    expect(
      parseBookChoice('can you switch to ABC Construction please', books)
        ?.companyId,
    ).toBe(3);
    expect(
      parseBookChoice('switch to abc construction books', books)?.companyId,
    ).toBe(3);
    expect(parseBookChoice('move it to book 2', books)?.companyId).toBe(3);
    expect(
      parseBookChoice('this is for my personal books', books)?.companyId,
    ).toBeNull();
    expect(
      parseBookChoice('switch to the bakery account', books)?.companyId,
    ).toBe(4);
    // "abc" fits two books: not a choice — the agent asks which one.
    expect(parseBookChoice('switch to abc', books)).toBeNull();
    expect(bookCandidates('switch to abc', books)).toHaveLength(2);
    expect(whichBookQuestion(bookCandidates('abc', books), books)).toBe(
      'Which one do you mean: 2 ABC Construction Inc. or 3 ABC Bakery? Reply with the number.',
    );
  });

  it('is not a choice for a question or an unknown number', () => {
    expect(parseBookChoice('what did I spend in March?', options)).toBeNull();
    expect(parseBookChoice('9', options)).toBeNull();
    expect(isSwitchRequest('switch to ABC')).toBe(true);
    expect(isSwitchRequest('what about ABC')).toBe(false);
  });
});

describe('systemPrompt', () => {
  it('carries the channel style, the rules and the attachment section', () => {
    const p = systemPrompt({
      channel: 'SMS',
      today: '2026-10-20',
      bookLabel: 'their personal / general books',
      rules: '\n\nHouse rules…\n1. x',
      attachment: { id: 9, whyNotMatched: 'No transaction of $12' },
    });
    expect(p).toContain(channelStyle('SMS'));
    expect(p).toContain('House rules');
    expect(p).toContain('THIS CHAT IS ABOUT ONE FILE');
    expect(p).toContain('No transaction of $12');
  });

  it('has no attachment section in an ordinary chat', () => {
    const p = systemPrompt({
      channel: 'BOT',
      today: 'x',
      bookLabel: 'y',
      rules: '',
    });
    expect(p).not.toContain('ONE FILE');
  });
});

describe('agentBody', () => {
  it('sends tools, tool calls and tool results in the chat-completions shape', () => {
    const body = agentBody({
      model: 'gpt-4.1',
      timeoutMs: 1,
      tools: [
        {
          name: 'list_rules',
          description: 'd',
          parameters: { type: 'object' },
        },
      ],
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'c1', name: 'list_rules', arguments: '{}' }],
        },
        { role: 'tool', toolCallId: 'c1', content: '[]' },
      ],
    });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'list_rules',
          description: 'd',
          parameters: { type: 'object' },
        },
      },
    ]);
    expect(body.tool_choice).toBe('auto');
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'list_rules', arguments: '{}' },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '[]',
    });
  });

  it('sends no tools when none are given', () => {
    const body = agentBody({
      model: 'm',
      timeoutMs: 1,
      messages: [{ role: 'user', content: 'u' }],
    });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});
