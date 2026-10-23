/**
 * The AI's instructions as rows (step12, `AiInstruction`) — pure, so the key rules and the
 * blocks are tested without a database.
 *
 * - target ASSISTANT, not strong: the regular AI's whole system prompt. FIXED keys (below)
 *   replace one block of `systemPrompt`; the code keeps a default for each, so a missing row
 *   (or an empty table) gives exactly the built-in prompt. Any other key (`extra.<slug>`) is an
 *   added block.
 * - another target: extra instructions appended to that AI step's prompt (next to the learned
 *   rules), e.g. ATTACHMENT_READER for "the AI misread my receipt".
 * - isStrong: the strong AI's own prompt (`strong.role`, `strong.app_guide`).
 */

export const INSTRUCTION_TARGETS = [
  'ASSISTANT',
  'ATTACHMENT_READER',
  'MATCHER',
  'STATEMENT_READER',
  'PRODUCT_CATEGORIZER',
  'BANK_FEED_CATEGORIZER',
] as const;
export type InstructionTarget = (typeof INSTRUCTION_TARGETS)[number];

export const isInstructionTarget = (t: unknown): t is InstructionTarget =>
  typeof t === 'string' &&
  (INSTRUCTION_TARGETS as readonly string[]).includes(t);

/** What each target is — told to the strong AI so it edits the right step. */
export const TARGET_DESCRIPTIONS: Record<InstructionTarget, string> = {
  ASSISTANT:
    'the chat / text / WhatsApp / email / phone assistant that talks to the customer',
  ATTACHMENT_READER:
    'the vision step that reads an uploaded or texted file (receipt, invoice, cheque, deposit slip, letter…): what kind of document it is, vendor, date, amounts, items',
  MATCHER:
    'the step that chooses which bank transaction a read receipt / cheque belongs to, among candidates the code already narrowed by amount and date',
  STATEMENT_READER:
    'the step that reads every row of a bank / credit-card statement PDF',
  PRODUCT_CATEGORIZER:
    'the step that picks a category for each item on a receipt',
  BANK_FEED_CATEGORIZER:
    'the step that names and categorizes bank-feed (Plaid) rows the rules and memories did not know',
};

/** The regular assistant's fixed blocks, in prompt order. */
export const FIXED_ASSISTANT_KEYS = [
  'core',
  'core.safety',
  'core.answers',
  'core.issues',
  'core.channels',
  'channel.BOT',
  'channel.SMS',
  'channel.WHATSAPP',
  'channel.EMAIL',
  'channel.VOICE',
  'contact',
  'ask_ai',
  'files',
] as const;
export type FixedAssistantKey = (typeof FIXED_ASSISTANT_KEYS)[number];

export const isFixedKey = (k: string): k is FixedAssistantKey =>
  (FIXED_ASSISTANT_KEYS as readonly string[]).includes(k);

/** Keys the strong AI may never touch (staff only). */
export const LOCKED_KEYS: readonly string[] = ['core.safety'];

export const STRONG_KEYS = ['strong.role', 'strong.app_guide'] as const;

export const MAX_INSTRUCTION_CHARS = 8000;

/** `extra.<slug>`: lower-case words joined by dashes or dots. */
export const isExtraKey = (k: string): boolean =>
  /^extra\.[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(k) && k.length <= 64;

/** "Read handwritten totals" → "extra.read-handwritten-totals" (cut to fit the column). */
export function extraKeyFor(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return `extra.${slug || 'note'}`;
}

/** Trimmed text, at most `MAX_INSTRUCTION_CHARS`; null when empty. */
export function cleanInstructionText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\r\n/g, '\n').trim();
  return t ? t.slice(0, MAX_INSTRUCTION_CHARS) : null;
}

/** The regular assistant's rows, ready for `systemPrompt`. */
export interface AssistantTexts {
  /** A fixed key's text from the DB (absent = the code's default). */
  byKey: Partial<Record<FixedAssistantKey, string>>;
  /** `extra.*` blocks, in sortOrder. */
  extras: string[];
}

export const NO_TEXTS: AssistantTexts = { byKey: {}, extras: [] };

export interface InstructionRowLike {
  key: string;
  text: string;
  target: string;
  isStrong: boolean;
  sortOrder: number;
  id: number;
}

/** The live (not deleted) rows of the regular assistant → `AssistantTexts`. */
export function assistantTexts(
  rows: readonly InstructionRowLike[],
): AssistantTexts {
  const out: AssistantTexts = { byKey: {}, extras: [] };
  const sorted = [...rows]
    .filter((r) => !r.isStrong && r.target === 'ASSISTANT')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const r of sorted) {
    if (isFixedKey(r.key)) out.byKey[r.key] = r.text;
    else if (r.text.trim()) out.extras.push(r.text.trim());
  }
  return out;
}

/** The block appended to another AI step's prompt ('' when none). */
export function extrasBlock(
  rows: readonly InstructionRowLike[],
  target: InstructionTarget,
): string {
  const texts = [...rows]
    .filter((r) => !r.isStrong && r.target === target && r.text.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((r) => `- ${r.text.trim()}`);
  return texts.length
    ? `\n\nAdditional instructions from CYG Finance (follow them):\n${texts.join('\n')}`
    : '';
}

/** Fill `{{name}}` placeholders; an unknown one is left as written. */
export function fillPlaceholders(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    name in values ? values[name] : m,
  );
}
