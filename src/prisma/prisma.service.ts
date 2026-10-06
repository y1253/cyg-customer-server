import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects LAZILY, on the first query, rather than in `onModuleInit`: the API boots and
 * answers `/api/health` with no database configured yet, which is the state a fresh
 * checkout is in.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: process.env.DATABASE_URL });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
