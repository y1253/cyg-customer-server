import { Injectable } from '@nestjs/common';
import type { BookScope } from './scope';
import {
  TaxService,
  type ContainsRuleView,
  type NameGroupView,
  type NameView,
  type NamesView,
  type UnrecognizedView,
} from './tax.service';
import { SubNamesService, type SubNameView } from './sub-names.service';
import {
  filterContains,
  filterNames,
  filterUnrecognized,
  groupCounts,
  nameMatches,
  pageOfNames,
  pickSubs,
  subsByParent,
} from './names-query.util';

/** One page of the Names tab's list, with what its rows need of their sub-names. */
export interface NamesPage {
  names: NameView[];
  nextOffset: number | null;
  /** How many names the list holds in all (this filter and search). */
  total: number;
  subNames: SubNameView[];
  subDescriptions: NamesView['subDescriptions'];
  subContains: NamesView['subContains'];
  subExceptionOf: NamesView['subExceptionOf'];
  /** Per name (lower-cased): the description keys the bank-description search found. */
  matches: Record<string, string[]>;
  /** The first page (offset 0) also carries what the tab shows around the list. */
  head?: NamesHead;
}

/** What the tab shows around the list: groups, chip counts, Unclarified, category-only rules. */
export interface NamesHead {
  groups: NameGroupView[];
  counts: Record<string, number>;
  unclarified: NameView | null;
  unrecognizedCount: number;
  containsRules: ContainsRuleView[];
}

/**
 * step11 (2026-11-23, user's request: "infinite scrolling on the server like the ledger"):
 * the Names tab asks for one page of names at a time, filtered and searched here.
 * `TaxService.names()` stays the one builder (the old `GET names` is unchanged).
 */
@Injectable()
export class NamesQueryService {
  constructor(
    private readonly tax: TaxService,
    private readonly subNames: SubNamesService,
  ) {}

  private async load(scope: BookScope, rawQ: string | undefined) {
    const q = (rawQ ?? '').trim().toLowerCase();
    const [view, subs, found] = await Promise.all([
      this.tax.names(scope),
      this.subNames.list(scope),
      q.length >= 2
        ? this.tax.searchDescriptions(scope, q)
        : Promise.resolve([]),
    ]);
    const hits = new Map<string, Set<string>>();
    for (const h of found) {
      const k = h.name.toLowerCase();
      hits.set(k, (hits.get(k) ?? new Set<string>()).add(h.key));
    }
    return { q, view, subs: subsByParent(subs), hits };
  }

  async page(
    scope: BookScope,
    query: { filter: string; q?: string },
    offset: number,
    limit: number,
  ): Promise<NamesPage> {
    const { q, view, subs, hits } = await this.load(scope, query.q);
    const list = filterNames(view, subs, { filter: query.filter, q, hits });
    const { items, nextOffset } = pageOfNames(list, offset, limit);
    const subNames = items.flatMap((n) => subs.get(n.name.toLowerCase()) ?? []);
    const ids = subNames.map((s) => s.id);
    const matches: Record<string, string[]> = {};
    for (const n of items) {
      const h = hits.get(n.name.toLowerCase());
      if (h) matches[n.name.toLowerCase()] = [...h];
    }
    return {
      names: items,
      nextOffset,
      total: list.length,
      subNames,
      subDescriptions: pickSubs(view.subDescriptions, ids),
      subContains: pickSubs(view.subContains, ids),
      subExceptionOf: pickSubs(view.subExceptionOf, ids),
      matches,
      ...(offset === 0 && { head: this.head(view, subs, q, hits) }),
    };
  }

  private head(
    view: NamesView,
    subs: Map<string, SubNameView[]>,
    q: string,
    hits: Map<string, Set<string>>,
  ): NamesHead {
    const unclarified = view.names.find((n) => n.unclarified) ?? null;
    const unrecognized = filterUnrecognized(view.unrecognized, q);
    return {
      groups: view.groups,
      counts: {
        ...groupCounts(view, subs, { q, hits }),
        UNRECOGNIZED: unrecognized.length,
      },
      unclarified:
        unclarified && nameMatches(unclarified, [], view, { q, hits })
          ? unclarified
          : null,
      unrecognizedCount: unrecognized.length,
      containsRules: filterContains(view.containsRules, q),
    };
  }

  async unrecognized(
    scope: BookScope,
    rawQ?: string,
  ): Promise<UnrecognizedView[]> {
    const view = await this.tax.names(scope);
    return filterUnrecognized(
      view.unrecognized,
      (rawQ ?? '').trim().toLowerCase(),
    );
  }
}
