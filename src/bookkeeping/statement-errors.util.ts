import {
  PROBLEM_ORDER,
  type ProblemKind,
  type StatementProblem,
} from './statement-problem.util';

/** step9: one saved statement error as the client and the AI see it. */
export interface StatementErrorView {
  id: number;
  statementId: number;
  /** A `ProblemKind`, or OTHER (recorded by the AI). */
  kind: string;
  title: string;
  text: string;
  /** SYSTEM (a check) | AI */
  source: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
}

/** An open `StatementError` row, as far as the diff needs it. */
export interface OpenError {
  id: number;
  statementId: number;
  kind: string;
  title: string;
  text: string;
  source: string;
}

export interface ErrorPlan {
  create: Array<StatementProblem & { statementId: number }>;
  update: Array<StatementProblem & { id: number }>;
  /** Ids to mark resolved. */
  resolve: number[];
}

/**
 * step9: what to write so the saved errors equal what the checks found. Pure.
 * - a problem with no open row of its kind on that statement → create;
 * - an open row whose problem is still there → update when its words changed;
 * - an open SYSTEM row whose problem is gone (or whose statement is no longer read / was
 *   deleted) → resolve;
 * - a row the AI recorded (source AI) is never touched — only the AI resolves it;
 * - two open rows of one kind (a race) → the extra one is resolved.
 */
export function diffErrors(
  open: OpenError[],
  found: ReadonlyMap<number, StatementProblem[]>,
): ErrorPlan {
  const plan: ErrorPlan = { create: [], update: [], resolve: [] };
  const byKey = new Map<string, OpenError>();
  for (const e of open) {
    if (e.source === 'AI') continue;
    const key = `${e.statementId}:${e.kind}`;
    if (byKey.has(key)) plan.resolve.push(e.id);
    else byKey.set(key, e);
  }
  const kept = new Set<string>();
  for (const [statementId, problems] of found) {
    for (const p of problems) {
      const key = `${statementId}:${p.kind}`;
      if (kept.has(key)) continue;
      kept.add(key);
      const row = byKey.get(key);
      if (!row) plan.create.push({ ...p, statementId });
      else if (row.title !== p.title || row.text !== p.text)
        plan.update.push({ ...p, id: row.id });
    }
  }
  for (const [key, row] of byKey) if (!kept.has(key)) plan.resolve.push(row.id);
  return plan;
}

/** Worst first (`PROBLEM_ORDER`); the AI's own (OTHER) last, oldest first. Pure. */
export function orderErrors<T extends { kind: string; id: number }>(
  list: T[],
): T[] {
  const rank = (k: string) => {
    const i = PROBLEM_ORDER.indexOf(k as ProblemKind);
    return i === -1 ? PROBLEM_ORDER.length : i;
  };
  return [...list].sort((a, b) => rank(a.kind) - rank(b.kind) || a.id - b.id);
}
