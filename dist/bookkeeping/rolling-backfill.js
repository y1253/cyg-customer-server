"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRollingBackfill = runRollingBackfill;
exports.main = main;
const client_1 = require("@prisma/client");
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const rolling_backfill_util_1 = require("./rolling-backfill.util");
const statement_continuity_1 = require("./statement-continuity");
const scope_1 = require("./scope");
const asService = (db) => db;
async function books(db, bookId) {
    const rows = await db.bankStatement.findMany({
        where: {
            deletedAt: null,
            status: client_1.StatementStatus.DONE,
            source: { not: 'PLAID' },
            ...(bookId ? { bookId } : {}),
        },
        distinct: ['bookId'],
        select: { customerId: true, bookId: true, companyId: true },
        orderBy: { bookId: 'asc' },
    });
    return rows;
}
async function startsOf(db, scope) {
    const out = new Map();
    for (const r of (0, opening_balance_util_1.openingChain)(await (0, opening_balance_query_1.loadOpeningStatements)(asService(db), scope))) {
        out.set(r.bankAccount, (out.get(r.bankAccount) ?? 0) + 1);
    }
    return out;
}
const n = (d) => d === null ? null : Number(d);
async function fixBook(db, scope, apply) {
    const report = {
        bookId: scope.bookId,
        starts: {},
        fixed: [],
        skipped: [],
        rereads: [],
    };
    for (const [account, count] of await startsOf(db, scope)) {
        report.starts[account] = { before: count };
    }
    const statements = await db.bankStatement.findMany({
        where: {
            ...(0, scope_1.scopeWhere)(scope),
            deletedAt: null,
            status: client_1.StatementStatus.DONE,
            source: { not: 'PLAID' },
        },
        orderBy: { id: 'asc' },
    });
    for (const s of statements) {
        const rows = await db.bankTransaction.findMany({
            where: { statementId: s.id, splitOfId: null },
            orderBy: { position: 'asc' },
            select: {
                id: true,
                amount: true,
                balanceAfter: true,
                postingDate: true,
                debitAccount: true,
                creditAccount: true,
            },
        });
        const split = new Set((await db.bankTransaction.findMany({
            where: { statementId: s.id, splitOfId: { not: null } },
            select: { splitOfId: true },
            distinct: ['splitOfId'],
        })).map((r) => r.splitOfId));
        const fix = (0, rolling_backfill_util_1.planStatementFix)({
            openingBalance: n(s.openingBalance),
            closingBalance: n(s.closingBalance),
            statedDeposits: n(s.statedDeposits),
            statedWithdrawals: n(s.statedWithdrawals),
            statedDepositCount: s.statedDepositCount,
            statedWithdrawalCount: s.statedWithdrawalCount,
            verification: s.verification,
            accountKind: s.accountKind,
        }, rows.map((r) => ({
            id: r.id,
            amount: Number(r.amount),
            balanceAfter: n(r.balanceAfter),
            postingDate: r.postingDate?.toISOString().slice(0, 10) ?? null,
            locked: split.has(r.id),
        })));
        if (fix.skipped)
            report.skipped.push({ statementId: s.id, why: fix.skipped });
        if (!(0, rolling_backfill_util_1.changes)(fix))
            continue;
        const { detail, ...shown } = fix;
        report.fixed.push({ statementId: s.id, ...shown });
        if (!apply)
            continue;
        const byId = new Map(rows.map((r) => [r.id, r]));
        await db.$transaction([
            ...fix.flips.map((id) => {
                const r = byId.get(id);
                return db.bankTransaction.update({
                    where: { id },
                    data: {
                        amount: (-Number(r.amount)).toFixed(2),
                        debitAccount: r.creditAccount,
                        creditAccount: r.debitAccount,
                    },
                });
            }),
            ...fix.balances.map((b) => db.bankTransaction.update({
                where: { id: b.id },
                data: {
                    balanceAfter: b.balanceAfter === null ? null : b.balanceAfter.toFixed(2),
                },
            })),
            db.bankStatement.update({
                where: { id: s.id },
                data: {
                    ...(fix.opening !== undefined
                        ? { openingBalance: fix.opening.toFixed(2) }
                        : {}),
                    ...(fix.closing !== undefined
                        ? { closingBalance: fix.closing.toFixed(2) }
                        : {}),
                    ...(fix.verification
                        ? {
                            verification: fix.verification,
                            verificationDetail: detail,
                        }
                        : {}),
                },
            }),
        ]);
    }
    if (apply && report.fixed.length) {
        await db.$executeRaw `
      UPDATE BankStatement SET errorsCheckedAt = NULL
      WHERE bookId = ${scope.bookId} AND deletedAt IS NULL`;
    }
    for (const [account, count] of await startsOf(db, scope)) {
        report.starts[account] = {
            ...(report.starts[account] ?? { before: 0 }),
            after: count,
        };
    }
    return report;
}
async function rereadBook(db, scope, apply) {
    const report = {
        bookId: scope.bookId,
        starts: {},
        fixed: [],
        skipped: [],
        rereads: [],
    };
    for (const [account, count] of await startsOf(db, scope)) {
        report.starts[account] = { before: count };
    }
    const pairs = (0, statement_continuity_1.mismatchPairs)(await (0, opening_balance_query_1.loadOpeningStatements)(asService(db), scope));
    const open = await db.statementError.findMany({
        where: {
            resolvedAt: null,
            source: 'SYSTEM',
            kind: { in: ['ENDING', 'RUNNING'] },
            statementId: {
                in: (await db.bankStatement.findMany({
                    where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                    select: { id: true },
                })).map((s) => s.id),
            },
        },
        select: { statementId: true },
    });
    const ids = [...new Set([...pairs, ...open.map((e) => e.statementId)])];
    const queue = await db.bankStatement.findMany({
        where: {
            ...(0, scope_1.scopeWhere)(scope),
            id: { in: ids },
            deletedAt: null,
            status: client_1.StatementStatus.DONE,
            source: { not: 'PLAID' },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
    });
    report.rereads = queue.map((s) => s.id);
    if (apply && queue.length) {
        await db.bankStatement.updateMany({
            where: { id: { in: report.rereads }, status: client_1.StatementStatus.DONE },
            data: {
                status: client_1.StatementStatus.PENDING,
                attempts: 0,
                runs: 0,
                error: null,
                errorDetail: null,
                chainRereadAt: new Date(),
            },
        });
    }
    return report;
}
async function runRollingBackfill(db, opts) {
    const out = [];
    for (const scope of await books(db, opts.bookId)) {
        const r = opts.phase === 'fix'
            ? await fixBook(db, scope, opts.apply)
            : await rereadBook(db, scope, opts.apply);
        if (r.fixed.length || r.skipped.length || r.rereads.length)
            out.push(r);
    }
    return out;
}
async function main() {
    const { PrismaClient: Client } = require('@prisma/client');
    const args = process.argv.slice(1);
    const phase = args.includes('reread') ? 'reread' : 'fix';
    const book = args.find((a) => a.startsWith('--book='));
    const db = new Client();
    try {
        const report = await runRollingBackfill(db, {
            phase,
            apply: args.includes('--apply'),
            bookId: book ? Number(book.slice(7)) : undefined,
        });
        console.log(JSON.stringify({ phase, apply: args.includes('--apply'), report }, null, 1));
    }
    finally {
        await db.$disconnect();
    }
}
//# sourceMappingURL=rolling-backfill.js.map