/**
 * step8 (2026-11-11): the customer's own ledger columns — the rules, PURE. A COPY lives in
 * the client (`client/src/lib/custom-columns.ts`) so a cell refuses a bad answer before it
 * is sent (user's request); the server checks again here. Keep the two in step.
 *
 * Types (user's words: "min char, max char, number only, text only, dropdown"):
 * - TEXT     any text
 * - LETTERS  text only — no digits
 * - NUMBER   number only — digits, an optional minus and decimals ("-12.50")
 * - DROPDOWN one of the column's options
 * min / max characters count what was typed (trimmed); a DROPDOWN has none.
 */

export const CUSTOM_COLUMN_TYPES = [
  'TEXT',
  'LETTERS',
  'NUMBER',
  'DROPDOWN',
] as const;
export type CustomColumnType = (typeof CUSTOM_COLUMN_TYPES)[number];

/** Per book. */
export const MAX_CUSTOM_COLUMNS = 20;
export const MAX_OPTIONS = 100;
export const MAX_ANSWER_CHARS = 1000;

export interface CustomColumnRules {
  type: CustomColumnType;
  minChars: number | null;
  maxChars: number | null;
}

export interface ColumnInput {
  name: string;
  type: string;
  minChars?: number | null;
  maxChars?: number | null;
  required?: boolean;
  /** DROPDOWN: the options in order; `id` keeps an existing one. */
  options?: Array<{ id?: number; label: string }>;
}

export interface CleanColumn {
  name: string;
  type: CustomColumnType;
  minChars: number | null;
  maxChars: number | null;
  required: boolean;
  options: Array<{ id?: number; label: string }>;
}

/** A column as the customer described it, cleaned — or the reason it cannot be saved. */
export function cleanColumn(input: ColumnInput): CleanColumn | string {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return 'Give the column a name';
  if (name.length > 64) return 'A column name is at most 64 characters';
  const type = CUSTOM_COLUMN_TYPES.find((t) => t === input.type);
  if (!type) return 'Pick what the column holds';
  const int = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? null : v;
  let minChars = type === 'DROPDOWN' ? null : int(input.minChars);
  let maxChars = type === 'DROPDOWN' ? null : int(input.maxChars);
  for (const v of [minChars, maxChars]) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > MAX_ANSWER_CHARS)) {
      return `Characters must be a whole number from 0 to ${MAX_ANSWER_CHARS}`;
    }
  }
  if (minChars === 0) minChars = null;
  if (maxChars === 0) maxChars = null;
  if (minChars !== null && maxChars !== null && minChars > maxChars) {
    return 'The minimum is more than the maximum';
  }
  let options: CleanColumn['options'] = [];
  if (type === 'DROPDOWN') {
    const seen = new Set<string>();
    for (const o of input.options ?? []) {
      const label = (o.label ?? '').trim().replace(/\s+/g, ' ');
      if (!label) continue;
      if (label.length > 120) return 'An option is at most 120 characters';
      const k = label.toLowerCase();
      if (seen.has(k)) return `“${label}” is in the list twice`;
      seen.add(k);
      options.push(o.id ? { id: o.id, label } : { label });
    }
    if (!options.length) return 'A dropdown needs at least one option';
    if (options.length > MAX_OPTIONS) {
      return `A dropdown has at most ${MAX_OPTIONS} options`;
    }
  } else {
    options = [];
  }
  return {
    name,
    type,
    minChars,
    maxChars,
    required: input.required === true,
    options,
  };
}

/**
 * Why a typed answer breaks the column's rules, or null when it is fine. An empty answer is
 * always allowed (it clears the cell). DROPDOWN answers are checked by option id instead.
 */
export function answerProblem(
  rules: CustomColumnRules,
  raw: string,
): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length > MAX_ANSWER_CHARS) {
    return `At most ${MAX_ANSWER_CHARS} characters`;
  }
  if (rules.type === 'NUMBER' && !/^-?\d+(?:[.,]\d+)?$/.test(v)) {
    return 'Numbers only';
  }
  if (rules.type === 'LETTERS' && /\d/.test(v)) {
    return 'Text only — no digits';
  }
  if (rules.minChars !== null && v.length < rules.minChars) {
    return `At least ${rules.minChars} character${rules.minChars === 1 ? '' : 's'}`;
  }
  if (rules.maxChars !== null && v.length > rules.maxChars) {
    return `At most ${rules.maxChars} character${rules.maxChars === 1 ? '' : 's'}`;
  }
  return null;
}
