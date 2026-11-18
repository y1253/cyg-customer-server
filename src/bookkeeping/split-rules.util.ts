import { cents } from './reconcile.util';
import { includedTaxes, type TaxKind } from './tax.util';

/**
 * step9 part 4 (2026-11-15): split rules (were "tax agencies"). A rule assigned to a name
 * writes REAL splits once on each row of it — the splits are regular splits afterwards
 * (user's decision: a one-time command). Pure rules here; `SplitRulesService` writes them.
 */

export type RateMode = 'PERCENT' | 'FIXED';

/** One rate of a rule: In (`SALES`, money in) or Out (`PURCHASE`, money out). */
export interface RuleRate {
  kind: TaxKind;
  mode: RateMode;
  /** PERCENT: a percent (10 = 10%). */
  rate: number;
  /** FIXED: the amount split out of each row. */
  amount: number | null;
}

export interface SplitRule {
  id: number;
  name: string;
  /** Where its splits post; null = the rule's own name (a liability account). */
  category: string | null;
  /** step9 (2026-11-17): its split group (`SplitGroup`); null / absent = individual. */
  groupId?: number | null;
  rates: RuleRate[];
}

/** The rate direction a row takes, from the money: in = `SALES`, out = `PURCHASE`. */
export function directionOf(amount: number): TaxKind | null {
  if (cents(amount) > 0) return 'SALES';
  if (cents(amount) < 0) return 'PURCHASE';
  return null;
}

/** The account a rule's splits post to. */
export const ruleCategory = (rule: Pick<SplitRule, 'name' | 'category'>) =>
  rule.category?.trim() || rule.name;

export interface RuleSplit {
  ruleId: number;
  category: string;
  /** Positive, in dollars (signed like the row when written). */
  amount: number;
}

/**
 * The splits `rules` take out of a line of `amount` (any sign; its direction picks each
 * rule's In or Out rate — a rule with none for it takes nothing). FIXED rates first, each
 * at most what is left; then the PERCENT rates on what is left, INCLUDED in it like tax
 * (user's decision: $100 at 10% = $90.91 stays + $9.09 split out; several percents share
 * one `includedTaxes`, so they always add back to the cent). Never more than the line;
 * zero splits are dropped.
 */
export function ruleSplits(
  amount: number,
  rules: readonly SplitRule[],
): RuleSplit[] {
  const kind = directionOf(amount);
  if (!kind) return [];
  let left = Math.abs(cents(amount));
  const out: RuleSplit[] = [];
  const percent: Array<{ rule: SplitRule; rate: number }> = [];
  for (const rule of rules) {
    const r = rule.rates.find((x) => x.kind === kind);
    if (!r) continue;
    if (r.mode === 'FIXED') {
      const take = Math.min(left, Math.max(0, cents(r.amount ?? 0)));
      if (take <= 0) continue;
      left -= take;
      out.push({
        ruleId: rule.id,
        category: ruleCategory(rule),
        amount: take / 100,
      });
    } else if (r.rate > 0) {
      percent.push({ rule, rate: r.rate });
    }
  }
  if (percent.length && left > 0) {
    const amounts = includedTaxes(
      left / 100,
      percent.map((p) => p.rate),
    );
    percent.forEach((p, i) => {
      if (amounts[i] > 0)
        out.push({
          ruleId: p.rule.id,
          category: ruleCategory(p.rule),
          amount: amounts[i],
        });
    });
  }
  return out;
}

/**
 * step9 (2026-11-17): `rules` (in pick order) as STEPS — an individual rule is a step of its
 * own, a split group's rules are one step, placed where its first rule is. A step's rules
 * share one amount (one `ruleSplits`); each step works on what the steps before it left.
 */
export function ruleSteps(rules: readonly SplitRule[]): SplitRule[][] {
  const steps: SplitRule[][] = [];
  const groups = new Map<number, SplitRule[]>();
  for (const rule of rules) {
    const g = rule.groupId ?? null;
    if (g === null) {
      steps.push([rule]);
      continue;
    }
    const step = groups.get(g);
    if (step) step.push(rule);
    else {
      const fresh = [rule];
      groups.set(g, fresh);
      steps.push(fresh);
    }
  }
  return steps;
}

/**
 * step9 (2026-11-17): the splits `rules` take out of a line of `amount`, step by step
 * (`ruleSteps`): an individual rule cuts what the rules before it left; a split group's
 * rules cut the same amount together (user's decision: "both run at once on the main
 * number"). $100, GST 5% then QST 9.975% individually = 4.76 + 8.64; as a group = 4.35 + 8.68.
 */
export function stepSplits(
  amount: number,
  rules: readonly SplitRule[],
): RuleSplit[] {
  const sign = cents(amount) < 0 ? -1 : 1;
  let left = Math.abs(cents(amount));
  const out: RuleSplit[] = [];
  for (const step of ruleSteps(rules)) {
    if (left <= 0) break;
    const splits = ruleSplits((sign * left) / 100, step);
    for (const s of splits) left -= cents(s.amount);
    out.push(...splits);
  }
  return out;
}

/** "In 5% · Out $2.00" — a rule's rates in words (logs and the AI's tools). */
export function ratesLabel(rates: readonly RuleRate[]): string {
  return rates
    .map(
      (r) =>
        `${r.kind === 'SALES' ? 'In' : 'Out'} ${
          r.mode === 'FIXED' ? `$${(r.amount ?? 0).toFixed(2)}` : `${r.rate}%`
        }`,
    )
    .join(' · ');
}
