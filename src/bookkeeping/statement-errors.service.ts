import {
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma, StatementStatus } from '@prisma/client';
import { changeFeed } from '../assistant/change-feed';
import { PrismaService } from '../prisma/prisma.service';
import { loadOpeningStatements } from './opening-balance.query';
import { openingChain, startsByAccount } from './opening-balance.util';
import { scopeOf, scopeWhere, type BookScope } from './scope';
import {
  printedEnding,
  statementErrors,
  type StatementProblem,
} from './statement-problem.util';
import {
  diffErrors,
  orderErrors,
  type OpenError,
  type StatementErrorView,
} from './statement-errors.util';
import { chronological } from './statement-order.util';

export type { StatementErrorView } from './statement-errors.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * step9 (2026-11-15, user's request): a statement's problems are SAVED as `StatementError`
 * rows, so Bank feeds shows them without working them out on every read, and the AI can read
 * and write them.
 *
 * - `refreshBook` runs every check (`statementErrors`) over one book — the checks cross
 *   statements (a chain break needs both neighbours), so it is always the whole book — and
 *   keeps the rows true: a new problem is added, a gone one is resolved (kept as history), a
 *   problem the AI recorded (source AI) is left for the AI to resolve.
 * - It runs after every read, balance change, move, delete and bank-feed rebuild
 *   (`refreshSoon`), a statement never checked is refreshed when its book is listed, and
 *   90 s after start every never-checked book is checked once (`errorsCheckedAt` null is the
 *   marker — the host has no ts-node, so no script).
 * Never throws, except the AI's own calls (`add` / `resolve`) on an unknown id.
 */
@Injectable()
export class StatementErrorsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StatementErrorsService.name);
  private readonly queued = new Map<number, BookScope>();
  private readonly running = new Map<number, Promise<number>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    setTimeout(() => void this.backfill(), 90_000).unref();
    setTimeout(() => void this.putInDateOrder(), 100_000).unref();
  }

  /**
   * 2026-11-16: statements saved before rows were stored by date (`chronological` in the
   * processor) — one whose rows are not in date order (Wise newest first, BMO #146 printed
   * both ways) gets `position` = its place by date, splits included (they share their
   * parent's). Then every book it touched, and every book with an open RUNNING error (the
   * check now carries the last printed balance through the rows after it), is checked again.
   * Runs at every start; rows already in date order are left alone, so it is idempotent.
   * Never throws.
   */
  async putInDateOrder(): Promise<void> {
    try {
      const statements = await this.prisma.bankStatement.findMany({
        where: {
          deletedAt: null,
          source: { not: 'PLAID' },
          status: { in: [StatementStatus.DONE, StatementStatus.NEEDS_REVIEW] },
        },
        select: { id: true, customerId: true, bookId: true, companyId: true },
        orderBy: { id: 'asc' },
      });
      const books = new Map<number, BookScope>();
      let moved = 0;
      for (let i = 0; i < statements.length; i += 50) {
        const chunk = statements.slice(i, i + 50);
        const rows = await this.prisma.bankTransaction.findMany({
          where: {
            statementId: { in: chunk.map((s) => s.id) },
            splitOfId: null,
          },
          select: {
            id: true,
            statementId: true,
            postingDate: true,
            amount: true,
            balanceAfter: true,
          },
          orderBy: [{ statementId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        });
        const byStatement = new Map<number, typeof rows>();
        for (const r of rows) {
          const list = byStatement.get(r.statementId) ?? [];
          list.push(r);
          byStatement.set(r.statementId, list);
        }
        for (const s of chunk) {
          const list = byStatement.get(s.id);
          if (!list || list.length < 2) continue;
          const ordered = chronological(
            list.map((r) => ({
              id: r.id,
              postingDate: day(r.postingDate),
              amount: Number(r.amount),
              balanceAfter:
                r.balanceAfter === null ? null : Number(r.balanceAfter),
            })),
          );
          if (ordered.every((r, i) => r.id === list[i].id)) continue;
          // One UPDATE per statement; a split takes its parent's new position.
          const cases = Prisma.join(
            ordered.map((r, i) => Prisma.sql`WHEN ${r.id} THEN ${i}`),
            ' ',
          );
          await this.prisma.$executeRaw`
            UPDATE BankTransaction
            SET position = CASE COALESCE(splitOfId, id) ${cases} ELSE position END
            WHERE statementId = ${s.id}`;
          this.logger.log(`statement #${s.id}: rows put in date order`);
          books.set(s.bookId, scopeOf(s));
          moved++;
        }
      }
      const running = await this.prisma.statementError.findMany({
        where: { kind: 'RUNNING', resolvedAt: null },
        select: { customerId: true, bookId: true, companyId: true },
        distinct: ['bookId'],
      });
      for (const r of running) books.set(r.bookId, scopeOf(r));
      for (const b of books.values()) await this.refreshBook(b);
      if (moved || books.size)
        this.logger.log(
          `date order: ${moved} statement(s) re-ordered, ${books.size} book(s) re-checked`,
        );
    } catch (err) {
      this.logger.error(`date order failed: ${message(err)}`);
    }
  }

  /** Check every book with a read statement that was never checked — once. */
  async backfill(): Promise<void> {
    try {
      const books = await this.prisma.bankStatement.groupBy({
        by: ['customerId', 'bookId', 'companyId'],
        where: {
          deletedAt: null,
          errorsCheckedAt: null,
          status: { in: [StatementStatus.DONE, StatementStatus.NEEDS_REVIEW] },
        },
      });
      if (!books.length) return;
      let open = 0;
      for (const b of books) open += await this.refreshBook(scopeOf(b));
      this.logger.log(
        `statement errors: checked ${books.length} book(s), ${open} open error(s)`,
      );
    } catch (err) {
      this.logger.error(`backfill failed: ${message(err)}`);
    }
  }

  /** Refresh this book in a moment (several changes in a row → one run). Never throws. */
  refreshSoon(scope: BookScope): void {
    this.queued.set(scope.bookId, scope);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const books = [...this.queued.values()];
      this.queued.clear();
      void (async () => {
        for (const b of books) await this.refreshBook(b);
      })();
    }, 1500);
    this.timer.unref?.();
  }

  /**
   * Run every check on one book and save the result. Returns the open errors left. One run
   * per book at a time (a second call waits for it, then runs again). Never throws.
   */
  async refreshBook(scope: BookScope): Promise<number> {
    const before = this.running.get(scope.bookId);
    const run = (before ?? Promise.resolve(0))
      .catch(() => 0)
      .then(() => this.refresh(scope));
    this.running.set(scope.bookId, run);
    try {
      return await run;
    } finally {
      if (this.running.get(scope.bookId) === run)
        this.running.delete(scope.bookId);
    }
  }

  private async refresh(scope: BookScope): Promise<number> {
    try {
      const found = await this.check(scope);
      const open = await this.prisma.statementError.findMany({
        where: { ...scopeWhere(scope), resolvedAt: null },
      });
      const plan = diffErrors(open as OpenError[], found);
      const now = new Date();
      await this.prisma.$transaction([
        ...plan.create.map((e) =>
          this.prisma.statementError.create({
            data: {
              ...scopeWhere(scope),
              statementId: e.statementId,
              kind: e.kind,
              title: e.title,
              text: e.text,
              details: (e.details ?? undefined) as Prisma.InputJsonValue,
            },
          }),
        ),
        ...plan.update.map((e) =>
          this.prisma.statementError.update({
            where: { id: e.id },
            data: {
              title: e.title,
              text: e.text,
              details: (e.details ?? Prisma.DbNull) as Prisma.InputJsonValue,
              checkedAt: now,
            },
          }),
        ),
        ...(plan.resolve.length
          ? [
              this.prisma.statementError.updateMany({
                where: { id: { in: plan.resolve } },
                data: { resolvedAt: now, resolvedBy: 'SYSTEM' },
              }),
            ]
          : []),
      ]);
      // Raw, so the statements' `updatedAt` (the stale-PROCESSING clock) is not touched.
      await this.prisma.$executeRaw`
        UPDATE BankStatement SET errorsCheckedAt = ${now}
        WHERE customerId = ${scope.customerId} AND bookId = ${scope.bookId} AND deletedAt IS NULL`;
      if (plan.create.length || plan.resolve.length) {
        changeFeed.bump(scope.customerId);
        this.logger.log(
          `book ${scope.bookId}: ${plan.create.length} new, ${plan.resolve.length} resolved statement error(s)`,
        );
      }
      return open.length + plan.create.length - plan.resolve.length;
    } catch (err) {
      this.logger.error(
        `book ${scope.bookId}: refresh failed: ${message(err)}`,
      );
      return 0;
    }
  }

  /**
   * Every check on every read statement of the book, by statement id — the same inputs
   * Bank feeds used to compute on each list (`BookkeepingService.list`).
   */
  async check(scope: BookScope): Promise<Map<number, StatementProblem[]>> {
    const [rows, opening] = await Promise.all([
      this.prisma.bankStatement.findMany({
        where: {
          ...scopeWhere(scope),
          deletedAt: null,
          status: { in: [StatementStatus.DONE, StatementStatus.NEEDS_REVIEW] },
        },
      }),
      loadOpeningStatements(this.prisma, scope),
    ]);
    const starts = new Map(
      [...startsByAccount(openingChain(opening)).values()]
        .flat()
        .map((s) => [s.statementId, s]),
    );
    const nets = new Map(
      [...opening, ...(opening.bridges ?? [])].map((o) => [o.id, o.net]),
    );
    const checked = rows.filter(
      (r) => r.status === StatementStatus.DONE && r.source !== 'PLAID',
    );
    const balances = checked.length
      ? await this.prisma.bankTransaction.findMany({
          where: {
            ...scopeWhere(scope),
            statementId: { in: checked.map((r) => r.id) },
            splitOfId: null,
          },
          select: {
            statementId: true,
            balanceAfter: true,
            postingDate: true,
            amount: true,
          },
          orderBy: [{ statementId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
        })
      : [];
    const rowsOf = new Map<
      number,
      Array<{
        balanceAfter: number | null;
        postingDate: string | null;
        amount: number;
      }>
    >();
    for (const t of balances) {
      const list = rowsOf.get(t.statementId) ?? [];
      list.push({
        balanceAfter: t.balanceAfter === null ? null : Number(t.balanceAfter),
        postingDate: day(t.postingDate),
        amount: Number(t.amount),
      });
      rowsOf.set(t.statementId, list);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = new Map<number, StatementProblem[]>();
    for (const r of rows) {
      const start = starts.get(r.id);
      const reason = start?.reason;
      const previous =
        reason?.kind === 'MISMATCH'
          ? byId.get(reason.previousStatementId)
          : undefined;
      const rereading =
        r.chainRereadAt !== null &&
        (r.processedAt === null || r.processedAt < r.chainRereadAt);
      out.set(
        r.id,
        statementErrors({
          ...r,
          openingBalance:
            r.openingBalance === null ? null : Number(r.openingBalance),
          closingBalance:
            r.closingBalance === null ? null : Number(r.closingBalance),
          net: nets.get(r.id),
          reason,
          rechecked:
            r.chainRereadAt !== null && previous?.chainRereadAt != null,
          rechecking: rereading,
          printedEnding: rowsOf.has(r.id)
            ? printedEnding(rowsOf.get(r.id)!, r.accountKind === 'CREDIT_CARD')
            : undefined,
          startDerived: start?.derived,
        }),
      );
    }
    return out;
  }

  /** The open errors of these statements (all of the book when omitted), worst first. */
  async openFor(
    scope: BookScope,
    statementIds?: number[],
  ): Promise<Map<number, StatementErrorView[]>> {
    const rows = await this.prisma.statementError.findMany({
      where: {
        ...scopeWhere(scope),
        resolvedAt: null,
        ...(statementIds && { statementId: { in: statementIds } }),
      },
      orderBy: { id: 'asc' },
    });
    const out = new Map<number, StatementErrorView[]>();
    for (const r of rows) {
      const list = out.get(r.statementId) ?? [];
      list.push(view(r));
      out.set(r.statementId, list);
    }
    for (const [id, list] of out) out.set(id, orderErrors(list));
    return out;
  }

  /** The AI's `list_statement_errors`. */
  async list(
    scope: BookScope,
    opts: { statementId?: number; includeResolved?: boolean } = {},
  ): Promise<StatementErrorView[]> {
    const rows = await this.prisma.statementError.findMany({
      where: {
        ...scopeWhere(scope),
        ...(opts.statementId && { statementId: opts.statementId }),
        ...(!opts.includeResolved && { resolvedAt: null }),
      },
      orderBy: [{ statementId: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map(view);
  }

  /** The AI's `add_statement_error`: a problem no check sees (the customer said so). */
  async add(
    scope: BookScope,
    input: { statementId: number; title: string; text: string; note?: string },
  ): Promise<StatementErrorView> {
    const statement = await this.prisma.bankStatement.findFirst({
      where: { id: input.statementId, ...scopeWhere(scope), deletedAt: null },
      select: { id: true },
    });
    if (!statement) throw new NotFoundException('Statement not found');
    const row = await this.prisma.statementError.create({
      data: {
        ...scopeWhere(scope),
        statementId: statement.id,
        kind: 'OTHER',
        source: 'AI',
        title: input.title.trim().slice(0, 191),
        text: input.text.trim(),
        note: input.note?.trim() || null,
      },
    });
    changeFeed.bump(scope.customerId);
    return view(row);
  }

  /**
   * The AI's `resolve_statement_error`. A check's error is checked again first: still
   * failing → not resolved (the AI is told why); gone → resolved by the check itself. An
   * error the AI recorded is resolved on its word.
   */
  async resolve(
    scope: BookScope,
    errorId: number,
    note?: string,
  ): Promise<{
    resolved: boolean;
    reason?: string;
    error: StatementErrorView;
  }> {
    const row = await this.prisma.statementError.findFirst({
      where: { id: errorId, ...scopeWhere(scope) },
    });
    if (!row) throw new NotFoundException('Statement error not found');
    if (row.resolvedAt) return { resolved: true, error: view(row) };
    if (row.source !== 'AI') {
      await this.refreshBook(scope);
      const after = await this.prisma.statementError.findUniqueOrThrow({
        where: { id: errorId },
      });
      if (!after.resolvedAt) {
        return {
          resolved: false,
          reason: `The check still fails: ${after.text} Fix the cause (set the balances the statement prints, or re-read it) — the error then clears by itself.`,
          error: view(after),
        };
      }
      if (note?.trim()) {
        await this.prisma.statementError.update({
          where: { id: errorId },
          data: { note: note.trim() },
        });
      }
      return { resolved: true, error: view(after) };
    }
    const done = await this.prisma.statementError.update({
      where: { id: errorId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: 'AI',
        note: note?.trim() || row.note,
      },
    });
    changeFeed.bump(scope.customerId);
    return { resolved: true, error: view(done) };
  }
}

function view(r: {
  id: number;
  statementId: number;
  kind: string;
  title: string;
  text: string;
  source: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  note: string | null;
}): StatementErrorView {
  return {
    id: r.id,
    statementId: r.statementId,
    kind: r.kind,
    title: r.title,
    text: r.text,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedBy: r.resolvedBy,
    note: r.note,
  };
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
