import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
export interface FirmReach {
    numbers: string[];
    whatsapp: string[];
    voice: boolean;
    email: string | null;
}
export declare function firmReach(prisma: PrismaService, config: ConfigService): Promise<FirmReach>;
export declare function reachWords(r: FirmReach): string | null;
