/**
 * One-time backfill of `BankStatement.accountKind` for statements read before it existed
 * (2026-10-14), so a credit card's starting balance is posted as a DEBT and the card is a
 * liability in the reports — no re-read, no OpenAI.
 *
 * A statement is a CREDIT_CARD when its stored ending-balance check was made with the
 * balances NEGATED (the checker found they only add up as the amount OWED — the old code
 * stored that check as −closing), or its bank / account name is a card brand. Everything
 * else is BANK. Idempotent: only rows with no `accountKind` are touched.
 *
 *   npx ts-node -T scripts/backfill-account-kind.ts [--dry-run]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const CARD_NAME = /\b(amex|american express|visa|master ?card)\b/i;

interface StoredCheck {
  name?: string;
  expected?: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.bankStatement.findMany({
      where: { accountKind: null },
      select: {
        id: true,
        accountName: true,
        bankName: true,
        closingBalance: true,
        verificationDetail: true,
      },
    });
    let cards = 0;
    for (const r of rows) {
      const checks = Array.isArray(r.verificationDetail)
        ? (r.verificationDetail as StoredCheck[])
        : [];
      const balance = checks.find((c) => c?.name === 'balance');
      const closing =
        r.closingBalance === null
          ? 0
          : Math.round(Number(r.closingBalance) * 100);
      const owed =
        closing !== 0 &&
        typeof balance?.expected === 'number' &&
        balance.expected === -closing;
      const named = CARD_NAME.test(
        `${r.bankName ?? ''} ${r.accountName ?? ''}`,
      );
      const kind = owed || named ? 'CREDIT_CARD' : 'BANK';
      if (kind === 'CREDIT_CARD') {
        cards++;
        console.log(
          `#${r.id} ${r.accountName ?? r.bankName ?? '?'} → CREDIT_CARD (${owed ? 'balances owed' : 'card name'})`,
        );
      }
      if (!dryRun) {
        await prisma.bankStatement.update({
          where: { id: r.id },
          data: { accountKind: kind },
        });
      }
    }
    console.log(
      `${rows.length} statements, ${cards} credit card(s) — ${dryRun ? 'dry run, nothing written' : 'updated'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
