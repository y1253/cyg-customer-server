/**
 * The rules the AI assistant learns (step11) — pure, so the cap and the dedupe are tested.
 *
 * Two kinds feed every AI step of a book: firm-wide `AiRule`s a staff member approved, and
 * the book's own `CustomerAiRule`s. They are short sentences ("Amazon receipts match AMZN
 * MKTP charges"), so the block stays small however many accumulate.
 */

export const RULE_TOPICS = [
  'MATCHING',
  'CATEGORY',
  'NAMING',
  'GENERAL',
] as const;
export type RuleTopic = (typeof RULE_TOPICS)[number];

/** Longest rule text stored (the column is VarChar(200)). */
export const MAX_RULE_CHARS = 200;
/** At most this many rules, and this many characters, reach one prompt. */
export const MAX_RULES_IN_PROMPT = 40;
export const MAX_BLOCK_CHARS = 2000;

export interface PromptRule {
  text: string;
  topic: string;
  /** Firm-wide (approved by staff) or this book's own. */
  global: boolean;
}

export const isRuleTopic = (t: unknown): t is RuleTopic =>
  typeof t === 'string' && (RULE_TOPICS as readonly string[]).includes(t);

/** One line, trimmed, at most `MAX_RULE_CHARS`; null when nothing is left. */
export function cleanRuleText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const one = text.replace(/\s+/g, ' ').trim();
  if (!one) return null;
  return one.slice(0, MAX_RULE_CHARS);
}

/** The comparison key: case, spaces and punctuation folded, so a reworded copy is the same rule. */
export function ruleKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Does `topic` read a rule of `ruleTopic`? GENERAL rules reach every step. */
export function topicApplies(ruleTopic: string, topic?: RuleTopic): boolean {
  return !topic || ruleTopic === topic || ruleTopic === 'GENERAL';
}

/**
 * The "house rules" block appended to an AI step's system prompt, or '' when there are
 * none. The book's own rules come first (they are about this customer), then the firm's;
 * duplicates are dropped, and the block stops at the rule/character cap.
 */
export function rulesBlock(
  rules: readonly PromptRule[],
  topic?: RuleTopic,
): string {
  const seen = new Set<string>();
  const ordered = [
    ...rules.filter((r) => !r.global),
    ...rules.filter((r) => r.global),
  ].filter((r) => topicApplies(r.topic, topic));
  const lines: string[] = [];
  let size = 0;
  for (const r of ordered) {
    const text = cleanRuleText(r.text);
    if (!text) continue;
    const key = ruleKey(text);
    if (!key || seen.has(key)) continue;
    const line = `${lines.length + 1}. ${text}`;
    if (
      lines.length >= MAX_RULES_IN_PROMPT ||
      size + line.length > MAX_BLOCK_CHARS
    )
      break;
    seen.add(key);
    lines.push(line);
    size += line.length + 1;
  }
  if (!lines.length) return '';
  return `\n\nHouse rules learned from this firm's customers (follow them):\n${lines.join('\n')}`;
}
