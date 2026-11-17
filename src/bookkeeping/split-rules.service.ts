import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma, StatementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { doubleEntry } from './ledger.util';
import { cents } from './reconcile.util';
import { scopeWhere, type BookScope } from './scope';
import { ruleSplits, type SplitRule } from './split-rules.util';
import { remainderOf, signedLike, splitTotals } from './splits.util';
import { ensureSubName, syncParentSubNames } from './sub-name-parents';
import {
  includedTaxes,
  nameTaxKey,
  nameTaxLines,
  type Agency,
} from './tax.util';

const DONE = { deletedAt: null, status: StatementStatus.DONE };

/** What `apply` works on (absent = every row of the book). */
export interface ApplyTarget {
  /** Only these rules (newly picked); absent = every rule picked for the line's name. */
  ruleIds?: number[];
  /** Only rows of these names / sub-names (any case). */
  names?: string[];
  /** Only these transactions (parents) — the rows a statement read just created. */
  transactionIds?: number[];
}

/** One line a rule can split: a parent (what is left of it) or one of its splits. */
interface Line {
  parentId: number;
  /** The row the rule split is carved from — the parent itself or a split. */
  sourceId: number;
  /** The key its rules are picked under (its name, or its own-rules sub-name's name). */
  key: string;
  amount: number;
}

type ParentRow = Prisma.BankTransactionGetPayload<{
  include: { splits: true };
}>;

/**
 * step9 part 4 (2026-11-15): split rules (were tax agencies) WRITE splits. A rule picked
 * for a name (`LedgerNameAgency`) splits every existing row of the name once when it is
 * picked, and each new row once when it arrives (statement read, bank feed) — after that
 * they are regular splits the customer edits like any other (user's decisions). Removing a
 * pick leaves the splits it made. A sub-name with its own rules (`SubName.ownAgencies`)
 * splits its splits by its own picks.
 *
 * A rule split is a child `BankTransaction` (`splitRuleId`, `ruleSourceId` = the line it was
 * carved from). Carved from the parent, it simply lowers what the parent has left; carved
 * from a split, that split's amount goes down by it (the amount typed included it — the
 * step2 rule). (`ruleSourceId`, `splitRuleId`) makes it once only.
 */
@Injectable()
export class SplitRulesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SplitRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CustomerAccountsService,
  ) {}

  /** The book's live rules, by id. */
  async rules(scope: BookScope): Promise<Map<number, SplitRule>> {
    const rows = await this.prisma.taxAgency.findMany({
      where: { ...scopeWhere(scope), deletedAt: null, active: true },
      include: { rates: true },
      orderBy: { createdAt: 'asc' },
    });
    return new Map(
      rows.map((a) => [
        a.id,
        {
          id: a.id,
          name: a.name,
          category: a.category,
          rates: a.rates.map((r) => ({
            kind: r.kind,
            mode: r.mode,
            rate: Number(r.rate),
            amount: r.amount === null ? null : Number(r.amount),
          })),
        },
      ]),
    );
  }

  /** Split the rows `target` names by their names' rules. Returns how many splits were made. */
  async apply(scope: BookScope, target: ApplyTarget = {}): Promise<number> {
    const rules = await this.rules(scope);
    if (!rules.size) return 0;
    // A pick from before split rules waits for its conversion (`convertBook`).
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: { ...scopeWhere(scope), appliedAt: { not: null } },
      select: { name: true, agencyId: true },
      orderBy: { agencyId: 'asc' },
    });
    const wantRule = (id: number) =>
      rules.has(id) && (!target.ruleIds || target.ruleIds.includes(id));
    const rulesOf = new Map<string, number[]>();
    for (const p of picks) {
      if (!wantRule(p.agencyId)) continue;
      const k = nameTaxKey(p.name);
      rulesOf.set(k, [...(rulesOf.get(k) ?? []), p.agencyId]);
    }
    if (!rulesOf.size) return 0;
    const ownSubs = await this.ownRuleSubNames(scope);
    const parents = await this.parentsFor(scope, target, ownSubs);
    let made = 0;
    const touched: number[] = [];
    for (const p of parents) {
      const lines = this.linesOf(p, ownSubs);
      const done = new Set(
        p.splits
          .filter((s) => s.splitRuleId !== null)
          .map((s) => `${s.ruleSourceId}:${s.splitRuleId}`),
      );
      let n = 0;
      for (const line of lines) {
        const ids = (rulesOf.get(line.key) ?? []).filter(
          (id) => !done.has(`${line.sourceId}:${id}`),
        );
        if (!ids.length) continue;
        const splits = ruleSplits(
          line.amount,
          ids.map((id) => rules.get(id)!),
        );
        if (!splits.length) continue;
        n += await this.write(scope, p, line, splits);
      }
      if (n) {
        made += n;
        touched.push(p.id);
      }
    }
    if (touched.length) await syncParentSubNames(this.prisma, scope, touched);
    return made;
  }

  /** The rows a statement read / bank feed just created get their names' rules (never throws). */
  async applyToNew(scope: BookScope, transactionIds: number[]): Promise<void> {
    if (!transactionIds.length) return;
    try {
      const made = await this.apply(scope, { transactionIds });
      if (made)
        this.logger.log(
          `book ${scope.bookId}: ${made} rule split(s) on ${transactionIds.length} new row(s)`,
        );
    } catch (err) {
      this.logger.warn(
        `book ${scope.bookId}: split rules not applied to new rows: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Sub-names with their own rules: id → the name their picks are keyed by. */
  private async ownRuleSubNames(
    scope: BookScope,
  ): Promise<Map<number, string>> {
    const subs = await this.prisma.subName.findMany({
      where: { bookId: scope.bookId, ownAgencies: true },
      select: { id: true, name: true },
    });
    return new Map(subs.map((s) => [s.id, s.name]));
  }

  private async parentsFor(
    scope: BookScope,
    target: ApplyTarget,
    ownSubs: ReadonlyMap<number, string>,
  ): Promise<ParentRow[]> {
    const or: Prisma.BankTransactionWhereInput[] = [];
    if (target.names) {
      const keys = new Set(target.names.map(nameTaxKey));
      const subIds = [...ownSubs]
        .filter(([, name]) => keys.has(nameTaxKey(name)))
        .map(([id]) => id);
      // MySQL compares names case-insensitively.
      or.push({ name: { in: target.names } });
      if (keys.has(nameTaxKey(null))) or.push({ name: null });
      if (subIds.length) {
        or.push({ subNameId: { in: subIds } });
        or.push({ splits: { some: { subNameId: { in: subIds } } } });
      }
    }
    return this.prisma.bankTransaction.findMany({
      where: {
        ...scopeWhere(scope),
        splitOfId: null,
        statement: DONE,
        ...(target.transactionIds && { id: { in: target.transactionIds } }),
        ...(or.length && { OR: or }),
      },
      include: { splits: { orderBy: { id: 'asc' } } },
    });
  }

  /**
   * A parent's lines: what is left of it — the line holding the description — and each split
   * the customer made whose OWN sub-name has its own rules (`ownAgencies`). step9
   * (2026-11-17, user's request): a split that shares the transaction's name is never cut by
   * that name's rules — they cut the main line ("Walmart - Office Supply", not the tax split).
   * `everySplit`: the one-time conversion (`convertBook`) reproduces the old on-read tax
   * lines, which taxed every split by its own name.
   */
  private linesOf(
    p: ParentRow,
    ownSubs: ReadonlyMap<number, string>,
    everySplit = false,
  ): Line[] {
    const keyOf = (r: { name: string | null; subNameId: number | null }) =>
      nameTaxKey((r.subNameId !== null && ownSubs.get(r.subNameId)) || r.name);
    const totals = splitTotals(
      p.splits.map((s) => ({
        splitOfId: s.splitOfId,
        amount: Number(s.amount),
      })),
    );
    return [
      {
        parentId: p.id,
        sourceId: p.id,
        key: keyOf(p),
        amount: remainderOf({ ...p, amount: Number(p.amount) }, totals),
      },
      ...p.splits
        .filter(
          (s) =>
            s.splitRuleId === null &&
            (everySplit || (s.subNameId !== null && ownSubs.has(s.subNameId))),
        )
        .map((s) => ({
          parentId: p.id,
          sourceId: s.id,
          key: keyOf(s),
          // A split is stored with its transaction's sign.
          amount: Number(s.amount),
        })),
    ];
  }

  /** Writes a line's rule splits (and lowers a split line by them). Returns how many. */
  private async write(
    scope: BookScope,
    p: ParentRow,
    line: Line,
    splits: ReturnType<typeof ruleSplits>,
    names: ReadonlyArray<string | null> = [],
  ): Promise<number> {
    const parentAmount = Number(p.amount);
    const bank = parentAmount < 0 ? p.creditAccount : p.debitAccount;
    const subOf = new Map<string, number | null>();
    for (const s of splits) {
      if (subOf.has(s.category)) continue;
      // The name's own category needs no sub-name ("Walmart - GST" otherwise).
      subOf.set(
        s.category,
        p.name && s.category !== p.offsetAccount
          ? (await ensureSubName(this.prisma, scope, p.name, s.category)).id
          : null,
      );
    }
    const taken = splits.reduce((n, s) => n + cents(s.amount), 0);
    await this.prisma.$transaction([
      ...splits.map((s, i) =>
        this.prisma.bankTransaction.create({
          data: {
            ...scopeWhere(scope),
            statementId: p.statementId,
            position: p.position,
            pendingDate: p.pendingDate,
            postingDate: p.postingDate,
            description: p.description,
            name: names[i] ?? p.name,
            subNameId: names[i] ? null : subOf.get(s.category),
            amount: signedLike(parentAmount, s.amount).toFixed(2),
            offsetAccount: s.category,
            // The transaction's sign decides the sides.
            ...doubleEntry(parentAmount, bank, s.category),
            manualEdit: true,
            splitOfId: p.id,
            // step9 (2026-11-17): carved from a split, it sits under that split.
            parentSplitId: line.sourceId !== p.id ? line.sourceId : null,
            splitRuleId: s.ruleId,
            ruleSourceId: line.sourceId,
          },
        }),
      ),
      ...(line.sourceId !== p.id
        ? [
            this.prisma.bankTransaction.update({
              where: { id: line.sourceId },
              data: {
                amount: signedLike(
                  parentAmount,
                  Math.max(0, Math.abs(cents(line.amount)) - taken) / 100,
                ).toFixed(2),
              },
            }),
          ]
        : []),
    ]);
    return splits.length;
  }

  // ---- step9 part 4: the one-time conversion of the tax lines computed on read ----

  /**
   * Until step9 part 4 a name's agencies taxed its rows ON READ. Each book's lines are
   * written once as real rule splits — the same amounts the ledger showed (`includedTaxes`
   * over the line's rates, the line's category type deciding sales / purchase), the line's
   * custom name (one-time `TransactionTax.name`, else the "Always" `lineName`) as the
   * split's name — so no book changes. 80 s after start, every book with a pick not yet
   * applied (`LedgerNameAgency.appliedAt` null — every pick made since is applied at once);
   * then its picks are marked applied and its `TransactionTax` rows (they only held those
   * names) deleted, so it runs once.
   */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.convertAll(), 80_000).unref();
  }

  async convertAll(): Promise<void> {
    try {
      const books = await this.prisma.ledgerNameAgency.groupBy({
        by: ['customerId', 'bookId', 'companyId'],
        where: { appliedAt: null },
      });
      for (const b of books) {
        const made = await this.convertBook(b);
        if (made)
          this.logger.log(
            `book ${b.bookId}: ${made} tax line(s) written as rule splits`,
          );
      }
    } catch (err) {
      this.logger.warn(
        `tax lines not converted: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async convertBook(scope: BookScope): Promise<number> {
    const picks = await this.prisma.ledgerNameAgency.findMany({
      where: { ...scopeWhere(scope), appliedAt: null },
      select: { name: true, agencyId: true, lineName: true },
    });
    if (!picks.length) return 0;
    const [agencyRows, named, ctx, ownSubs] = await Promise.all([
      this.prisma.taxAgency.findMany({
        where: { ...scopeWhere(scope), deletedAt: null, active: true },
        include: { rates: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.transactionTax.findMany({
        where: { ...scopeWhere(scope), name: { not: null } },
        select: { transactionId: true, agencyId: true, name: true },
      }),
      this.typeContext(scope),
      this.ownRuleSubNames(scope),
    ]);
    // The old rates were percents only.
    const agencies: Agency[] = agencyRows.map((a) => ({
      id: a.id,
      name: a.name,
      rates: Object.fromEntries(
        a.rates
          .filter((r) => r.mode === 'PERCENT')
          .map((r) => [r.kind, Number(r.rate)]),
      ),
    }));
    const agenciesOf = new Map<string, number[]>();
    for (const p of picks) {
      const key = nameTaxKey(p.name);
      agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
    }
    const nameOf = new Map(
      named.map((n) => [`${n.transactionId}:${n.agencyId}`, n.name]),
    );
    const alwaysOf = new Map(
      picks.flatMap((p) =>
        p.lineName
          ? [[`${nameTaxKey(p.name)}:${p.agencyId}`, p.lineName] as const]
          : [],
      ),
    );
    const parents = await this.prisma.bankTransaction.findMany({
      where: { ...scopeWhere(scope), splitOfId: null, statement: DONE },
      include: { splits: { orderBy: { id: 'asc' } } },
    });
    let made = 0;
    for (const p of parents) {
      const lines = this.linesOf(p, ownSubs, true);
      const taxed = nameTaxLines(
        lines.map((l) => ({
          id: l.sourceId,
          name: l.key,
          // The old rule: the line's own category decides sales / purchase.
          offsetAccount:
            l.sourceId === p.id
              ? p.offsetAccount
              : p.splits.find((s) => s.id === l.sourceId)!.offsetAccount,
          amount: l.amount,
        })),
        agenciesOf,
        agencies,
        ctx,
      );
      if (!taxed.size) continue;
      for (const line of lines) {
        const tl = taxed.get(line.sourceId);
        if (!tl?.length) continue;
        const amounts = includedTaxes(
          line.amount,
          tl.map((t) => t.rate),
        );
        const splits = tl
          .map((t, i) => ({
            ruleId: t.agencyId,
            category: t.agency,
            amount: amounts[i],
          }))
          .filter((s) => s.amount > 0);
        if (!splits.length) continue;
        const names = tl.map(
          (t) =>
            nameOf.get(`${line.sourceId}:${t.agencyId}`) ??
            alwaysOf.get(`${line.key}:${t.agencyId}`) ??
            null,
        );
        made += await this.write(scope, p, line, splits, names);
      }
    }
    await this.prisma.$transaction([
      this.prisma.ledgerNameAgency.updateMany({
        where: { ...scopeWhere(scope), appliedAt: null },
        data: { appliedAt: new Date() },
      }),
      this.prisma.transactionTax.deleteMany({ where: scopeWhere(scope) }),
    ]);
    // Tax sub-names made ahead for names whose rows had no line: nothing points at them.
    const used = await this.prisma.bankTransaction.groupBy({
      by: ['subNameId'],
      where: { ...scopeWhere(scope), subNameId: { not: null } },
    });
    const usedIds = new Set(used.map((u) => u.subNameId));
    const names = new Set(agencyRows.map((a) => a.name));
    const empty = (
      await this.prisma.subName.findMany({
        where: { bookId: scope.bookId },
        select: { id: true, category: true },
      })
    ).filter((s) => names.has(s.category) && !usedIds.has(s.id));
    if (empty.length)
      await this.prisma.subName.deleteMany({
        where: { id: { in: empty.map((s) => s.id) } },
      });
    await syncParentSubNames(this.prisma, scope);
    return made;
  }

  private async typeContext(scope: BookScope) {
    const [overrides, custom, agencies] = await Promise.all([
      this.accounts.overrides(scope),
      this.accounts.types(scope),
      this.prisma.taxAgency.findMany({
        where: scopeWhere(scope),
        select: { name: true },
      }),
    ]);
    return {
      overrides,
      custom,
      liabilities: new Set(agencies.map((a) => a.name)),
    };
  }
}
