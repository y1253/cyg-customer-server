/**
 * step12: syncs the built-in `AiInstruction` rows from the code NOW, without restarting the
 * API (the API does the same at every start — `InstructionsService.syncBuiltins`). Inserts
 * missing keys; refreshes a row only while nobody has edited it since the last sync.
 *
 *   npx ts-node -T scripts/sync-ai-instructions.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { InstructionsService } from '../src/assistant/instructions.service';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await new InstructionsService(
      prisma as unknown as PrismaService,
    ).syncBuiltins();
    console.log(`${result.created} added, ${result.updated} updated`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
