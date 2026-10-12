import type { PrismaService } from '../prisma/prisma.service';

export interface Pricing {
  generatePriceCents: number;
  currency: string;
}

/**
 * The admin's price (the `CustomerPricing` singleton, edited in the internal app). Read
 * only — no row yet means Generate is free. Shared by billing and the bookkeeping
 * 402 gate, so it lives outside both modules.
 */
export async function readPricing(prisma: PrismaService): Promise<Pricing> {
  const row = await prisma.customerPricing.findUnique({
    where: { singleton: 'GLOBAL' },
  });
  return {
    generatePriceCents: row?.generatePriceCents ?? 0,
    currency: row?.currency ?? 'cad',
  };
}
