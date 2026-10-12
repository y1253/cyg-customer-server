import type { PrismaService } from '../prisma/prisma.service';
export interface Pricing {
    generatePriceCents: number;
    currency: string;
}
export declare function readPricing(prisma: PrismaService): Promise<Pricing>;
