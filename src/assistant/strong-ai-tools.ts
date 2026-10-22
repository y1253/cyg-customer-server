/**
 * The strong AI's tools and the pure pieces around them (step12) — tested without OpenAI.
 */
import type { ToolDefinition } from '../ai/openai.client';
import { READ_TOOLS, type AgentAction } from './assistant-tools';
import { INSTRUCTION_TARGETS, TARGET_DESCRIPTIONS } from './instructions.util';
import { RULE_TOPICS } from './rules.util';

export const VERDICTS = ['FIXED', 'NOT_AN_ISSUE', 'UNSURE'] as const;
export type Verdict = (typeof VERDICTS)[number] | 'FAILED';

const str = { type: 'string' };
const int = { type: 'integer' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** The regular agent's read tools the strong AI may also run (never its writes). */
export const SHARED_READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

const OWN_TOOLS: ToolDefinition[] = [
  {
    name: 'get_attachment_full',
    description:
      'Everything stored about one attachment of this book: the full reading (every document, items, totals, transcript), status, match note / error, the words sent with it, its channel, and the transaction it is attached to.',
    parameters: obj({ attachmentId: int }, ['attachmentId']),
  },
  {
    name: 'get_transaction',
    description:
      'One transaction of this book with its statement, name, category, splits and attachments.',
    parameters: obj({ transactionId: int }, ['transactionId']),
  },
  {
    name: 'list_instructions',
    description:
      "Every instruction block of the regular AI steps: key, target, title, locked, and the full text. Blocks with no row yet show the built-in text (source 'default').",
    parameters: obj({}),
  },
  {
    name: 'get_instruction_history',
    description:
      'The last changes to one instruction block (who, why, before / after).',
    parameters: obj({ key: str }, ['key']),
  },
  {
    name: 'update_instruction',
    description:
      'Replace the WHOLE text of one instruction block (by key). Keep everything that is still right. Locked blocks are refused.',
    parameters: obj({ key: str, text: str, reason: str }, [
      'key',
      'text',
      'reason',
    ]),
  },
  {
    name: 'create_instruction',
    description: `Add a new instruction block to one AI step. Targets: ${INSTRUCTION_TARGETS.map((t) => `${t} = ${TARGET_DESCRIPTIONS[t]}`).join('; ')}.`,
    parameters: obj(
      {
        target: { type: 'string', enum: [...INSTRUCTION_TARGETS] },
        title: str,
        text: str,
        reason: str,
      },
      ['target', 'title', 'text', 'reason'],
    ),
  },
  {
    name: 'delete_instruction',
    description:
      'Delete an added block (key extra.*). Fixed blocks can only be rewritten with update_instruction.',
    parameters: obj({ key: str, reason: str }, ['key', 'reason']),
  },
  {
    name: 'save_customer_rule',
    description:
      "A short rule (max 200 characters) private to THIS customer's book, live at once — for their own names, accounts or habits.",
    parameters: obj(
      { text: str, topic: { type: 'string', enum: [...RULE_TOPICS] } },
      ['text', 'topic'],
    ),
  },
  {
    name: 'delete_customer_rule',
    description:
      "Delete one of this book's learned rules (id from list_rules).",
    parameters: obj({ ruleId: int, reason: str }, ['ruleId', 'reason']),
  },
  {
    name: 'propose_global_rule',
    description:
      'A short firm-wide rule (max 200 characters) — PENDING until staff approve it.',
    parameters: obj(
      { text: str, topic: { type: 'string', enum: [...RULE_TOPICS] } },
      ['text', 'topic'],
    ),
  },
  {
    name: 'finish',
    description:
      'Your conclusion — call it once, at the end. summary = one or two plain sentences for staff. redo = what the regular assistant should now do for the customer with its own tools ("" when nothing).',
    parameters: obj(
      {
        verdict: { type: 'string', enum: [...VERDICTS] },
        summary: str,
        redo: str,
      },
      ['verdict', 'summary', 'redo'],
    ),
  },
];

export const STRONG_TOOLS: ToolDefinition[] = [
  ...READ_TOOLS.filter((t) => t.name !== 'get_link'),
  ...OWN_TOOLS,
];

export const WRITE_NAMES = new Set([
  'update_instruction',
  'create_instruction',
  'delete_instruction',
  'save_customer_rule',
  'delete_customer_rule',
  'propose_global_rule',
]);

export interface StrongFinish {
  verdict: Verdict;
  summary: string;
  redo: string;
}

/** The finish tool's arguments → a verdict (anything malformed is UNSURE). */
export function parseFinish(raw: string): StrongFinish {
  let a: Record<string, unknown> = {};
  try {
    a = (JSON.parse(raw || '{}') ?? {}) as Record<string, unknown>;
  } catch {
    // falls through to UNSURE
  }
  const verdict = (VERDICTS as readonly string[]).includes(a.verdict as string)
    ? (a.verdict as Verdict)
    : 'UNSURE';
  const text = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';
  return {
    verdict,
    summary: text(a.summary, 2000) || 'No summary given.',
    redo: text(a.redo, 2000),
  };
}

/**
 * A FIXED verdict without a single successful change is not a fix — the strong AI said so
 * but changed nothing, so the regular AI must not tell the customer it is fixed.
 */
export function settleVerdict(f: StrongFinish, changes: number): StrongFinish {
  return f.verdict === 'FIXED' && changes === 0
    ? { ...f, verdict: 'UNSURE' }
    : f;
}

/** What the regular assistant is told, and what shows under its answer. */
export function regularOutcome(f: StrongFinish): {
  instructions: string;
  summary: string;
  ok: boolean;
} {
  const redo = f.redo
    ? ` Now fix the customer's data with your tools: ${f.redo}`
    : '';
  switch (f.verdict) {
    case 'FIXED':
      return {
        instructions: `Our specialist checked and found the cause: ${f.summary} It has been fixed so it will not happen again. Apologise briefly and tell the customer it is fixed for next time.${redo}`,
        summary: 'Problem checked and fixed for next time',
        ok: true,
      };
    case 'NOT_AN_ISSUE':
      return {
        instructions: `Our specialist checked: no mistake in how we work (${f.summary}). Continue as you normally would — answer the customer and do what they ask.${redo}`,
        summary: 'Problem checked — no mistake found',
        ok: true,
      };
    default:
      return {
        instructions: `Our specialist could not confirm a mistake in how we work (${f.summary}). Continue as you normally would — answer the customer and do what they ask.${redo}`,
        summary: 'Problem checked',
        ok: true,
      };
  }
}

/** One earlier message for the case file: who, what, what the AI did. */
export function caseMessage(m: {
  id: number;
  role: string;
  text: string;
  actions: unknown;
  warning: string | null;
  createdAt: Date;
}): string {
  const actions = Array.isArray(m.actions) ? (m.actions as AgentAction[]) : [];
  const did = actions.length
    ? `\n  [AI did: ${actions.map((a) => `${a.ok ? '' : 'FAILED '}${a.tool}: ${a.summary}`).join('; ')}]`
    : '';
  const warn = m.warning ? `\n  [warning: ${m.warning}]` : '';
  return `#${m.id} ${m.createdAt.toISOString().slice(0, 16)} ${m.role}: ${m.text.slice(0, 2000)}${did}${warn}`;
}
