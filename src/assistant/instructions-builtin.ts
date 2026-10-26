/**
 * The built-in `AiInstruction` rows (step12): the regular assistant's fixed prompt blocks and
 * the strong AI's own guide, and the rule that keeps the table in step with this code. Pure.
 *
 * `InstructionsService.syncBuiltins` runs it at every start: a missing key is inserted, and a
 * row whose text differs from the code is updated ONLY while nobody has edited it since the
 * last sync (its newest change is a SEED one). So editing `DEFAULT_INSTRUCTIONS` or
 * `strong-ai-guide.ts` ships with the next deploy, and an edit by the strong AI or by staff is
 * never overwritten.
 */
import { DEFAULT_INSTRUCTIONS } from './assistant-prompt';
import { SALES_PITCH_DEFAULT } from '../sales/sales-prompt';
import {
  FIXED_ASSISTANT_KEYS,
  LOCKED_KEYS,
  SALES_PITCH_KEY,
} from './instructions.util';
import { STRONG_INSTRUCTIONS } from './strong-ai-guide';

export interface BuiltinInstruction {
  key: string;
  title: string;
  text: string;
  isStrong: boolean;
  locked: boolean;
  sortOrder: number;
  /** Absent = ASSISTANT. */
  target?: string;
}

const TITLES: Record<string, string> = {
  core: 'Who the assistant is and how it works',
  'core.safety': 'Safety (staff only)',
  'core.answers': 'Answering',
  'core.issues': 'When the customer says we got it wrong',
  'core.requests': "When the customer asks for something we can't do yet",
  'core.channels': 'Every channel: history, sending elsewhere, calls',
  contact: 'Preferred contact method',
  ask_ai: '"Ask AI" about one unfiled file',
  files: 'Files the customer just sent',
};

export const BUILTIN_INSTRUCTIONS: BuiltinInstruction[] = [
  ...FIXED_ASSISTANT_KEYS.map((key, i) => ({
    key,
    title: TITLES[key] ?? `Channel style — ${key.slice('channel.'.length)}`,
    text: DEFAULT_INSTRUCTIONS[key],
    isStrong: false,
    locked: LOCKED_KEYS.includes(key),
    sortOrder: (i + 1) * 10,
  })),
  ...STRONG_INSTRUCTIONS.map((s) => ({ ...s, isStrong: true, locked: true })),
  // step12f: the AI salesperson (phones with no account).
  {
    key: SALES_PITCH_KEY,
    title: 'How the salesperson sells',
    text: SALES_PITCH_DEFAULT,
    isStrong: false,
    locked: false,
    sortOrder: 10,
    target: 'SALES',
  },
];

export interface ExistingRow {
  id: number;
  key: string;
  text: string;
  /** Who made the newest `AiInstructionChange` of this row (null = none). */
  lastChangeBy: string | null;
}

export interface SyncPlan {
  create: BuiltinInstruction[];
  update: Array<{ row: ExistingRow; to: BuiltinInstruction }>;
}

/** What `syncBuiltins` writes. A row edited since the last sync is left alone. */
export function planSync(
  existing: readonly ExistingRow[],
  builtins: readonly BuiltinInstruction[] = BUILTIN_INSTRUCTIONS,
): SyncPlan {
  const byKey = new Map(existing.map((r) => [r.key, r]));
  const plan: SyncPlan = { create: [], update: [] };
  for (const b of builtins) {
    const row = byKey.get(b.key);
    if (!row) plan.create.push(b);
    else if (row.text !== b.text && row.lastChangeBy === 'SEED') {
      plan.update.push({ row, to: b });
    }
  }
  return plan;
}
