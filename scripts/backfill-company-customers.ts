/**
 * ONE-TIME (2026-10, step2): give every existing company a customer account so its
 * owner can sign in on cygfinance.com. Rules: `src/customer-auth/company-backfill.util.ts`.
 * New accounts get the password "CYGFinance" (bcrypt, cost 12). Tell those owners to
 * change it. Existing accounts keep theirs.
 *
 * DRY RUN by default; nothing is written without --apply.
 *
 *   npx ts-node -T scripts/backfill-company-customers.ts            # report only
 *   npx ts-node -T scripts/backfill-company-customers.ts --apply    # write
 *
 * Idempotent: only companies with customerId NULL are considered.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { planBackfill } from '../src/customer-auth/company-backfill.util';

const DEFAULT_PASSWORD = 'CYGFinance';
const BCRYPT_COST = 12;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const companies = await prisma.company.findMany({
      where: {
        customerId: null,
        isInternal: false,
        isDraft: false,
        deletedAt: null,
      },
      select: {
        id: true,
        businessName: true,
        contactInfo: { select: { privateEmail: true, personalName: true } },
      },
      orderBy: { id: 'asc' },
    });
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, email: true },
    });
    const plan = planBackfill(
      companies.map((c) => ({
        id: c.id,
        businessName: c.businessName,
        privateEmail: c.contactInfo?.privateEmail ?? null,
        personalName: c.contactInfo?.personalName ?? null,
      })),
      new Map(customers.map((c) => [c.email.toLowerCase(), c.id])),
    );

    const nameOf = (id: number) =>
      companies.find((c) => c.id === id)?.businessName ?? `#${id}`;
    const names = (ids: number[]) => ids.map(nameOf).join(', ');

    console.log(`\n${companies.length} companies without a customer account.\n`);
    console.log(
      `CREATE ${plan.create.length} account(s), password "${DEFAULT_PASSWORD}":`,
    );
    for (const r of plan.create) {
      console.log(`  ${r.email}  (${r.name})  <- ${names(r.companyIds)}`);
    }
    console.log(
      `\nLINK to an existing account (password untouched): ${plan.link.length}`,
    );
    for (const r of plan.link) {
      console.log(`  ${r.email}  #${r.customerId}  <- ${names(r.companyIds)}`);
    }
    console.log(
      `\nSKIPPED (fix the owner email, then re-run): ${plan.skipped.length}`,
    );
    for (const s of plan.skipped) {
      console.log(`  #${s.companyId} ${s.businessName} - ${s.reason}`);
    }

    if (!apply) {
      console.log('\nDry run - nothing written. Re-run with --apply to write.');
      return;
    }

    const passwordHash = await hash(DEFAULT_PASSWORD, BCRYPT_COST);
    for (const r of plan.create) {
      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            name: r.name,
            email: r.email,
            authType: 'PASSWORD',
            passwordHash,
          },
          select: { id: true },
        });
        await tx.company.updateMany({
          where: { id: { in: r.companyIds }, customerId: null },
          data: { customerId: customer.id },
        });
      });
    }
    for (const r of plan.link) {
      await prisma.company.updateMany({
        where: { id: { in: r.companyIds }, customerId: null },
        data: { customerId: r.customerId },
      });
    }
    console.log(
      `\nDone: ${plan.create.length} created, ${plan.link.length} linked, ${plan.skipped.length} skipped.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
