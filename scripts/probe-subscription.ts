/**
 * 2026-11-25 dev probe: the subscription state of a few customers, straight from the DB
 * (no Stripe, nothing sent). Creates their `CustomerSubscription` row on first look, like
 * the API does. `npx ts-node scripts/probe-subscription.ts [customerId…]`
 */
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from '../src/billing/subscription.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const config = new ConfigService(process.env);
  const silent = { send: async () => 'sent' } as never;
  const subs = new SubscriptionService(prisma, config, silent, silent);
  const ids = process.argv.slice(2).map(Number).filter(Boolean);
  const customers = ids.length
    ? ids
    : (
        await prisma.customer.findMany({
          where: { deletedAt: null },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 5,
        })
      ).map((c) => c.id);
  console.log('plan', await subs.plan());
  for (const id of customers) {
    const s = await subs.state(id);
    console.log(
      id,
      JSON.stringify({
        active: s.active,
        reason: s.reason,
        limited: s.limited,
        trial: s.trial,
        monthly: s.monthly,
        remaining: await subs.remainingTransactions(id),
        callMinutesLeft: await subs.callMinutesLeft(id),
      }),
    );
  }
  await prisma.$disconnect();
}

void main();
