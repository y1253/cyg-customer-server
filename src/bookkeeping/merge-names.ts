import type { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
import type { BookScope } from './scope';
import type { SubNamesService } from './sub-names.service';
import type { TaxService } from './tax.service';

export interface MergeNamesInput {
  from?: string;
  fromSubNameId?: number;
  into?: string;
  intoSubNameId?: number;
}

/**
 * step11 part 2 (2026-11-26): a name / sub-name merge (Names tab drag — the customer's own,
 * or staff's from the internal Rules tab), then QuickBooks follows. A whole name merged away
 * takes its QuickBooks payee with it (`QuickBooksSyncService.mergePayee`: renamed, or merged
 * into the target's payee); a sub-name's rows were pushed under their parent's payee, so a
 * push is enough. The payee name is read BEFORE the merge (the rows are renamed by it).
 */
export async function mergeNamesAndQuickBooks(
  subNames: SubNamesService,
  qbo: QuickBooksSyncService,
  scope: BookScope,
  input: MergeNamesInput,
): Promise<void> {
  const from = input.from ?? null;
  const pushedAs = from ? await qbo.pushedPayee(scope, from) : null;
  const into =
    from && input.into == null && input.intoSubNameId != null
      ? await subNames.parentOfSubName(scope, input.intoSubNameId)
      : (input.into ?? null);
  await subNames.merge(scope, input);
  if (from) qbo.mergePayee(scope, pushedAs, into);
  else qbo.syncSoon(scope.bookId);
}

/** One name of the internal Rules tab's drag list (no descriptions — staff do not need them). */
export interface StaffNameView {
  name: string;
  category: string;
  rows: number;
  total: number;
  group: string;
  /** Has sub-names: its rows live on them, it cannot be merged away. */
  wrapper: boolean;
  unclarified: boolean;
  subNames: Array<{
    id: number;
    name: string;
    category: string;
    rows: number;
    total: number;
  }>;
}

/** The Names tab's names with their sub-names, trimmed for the internal Rules tab. */
export async function staffNames(
  tax: TaxService,
  subNames: SubNamesService,
  scope: BookScope,
): Promise<StaffNameView[]> {
  const [view, subs] = await Promise.all([
    tax.names(scope),
    subNames.list(scope),
  ]);
  const subsOf = new Map<string, StaffNameView['subNames']>();
  for (const s of subs) {
    const key = s.parent.toLowerCase();
    const list = subsOf.get(key) ?? [];
    list.push({
      id: s.id,
      name: s.name,
      category: s.category,
      rows: s.rows,
      total: s.total,
    });
    subsOf.set(key, list);
  }
  return view.names.map((n) => {
    const own = subsOf.get(n.name.toLowerCase()) ?? [];
    return {
      name: n.name,
      category: n.category,
      rows: n.rows,
      total: n.total,
      group: n.group,
      wrapper: own.length > 0,
      unclarified: n.unclarified === true,
      subNames: own,
    };
  });
}
