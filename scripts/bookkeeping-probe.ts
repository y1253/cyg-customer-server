/**
 * Runs the REAL statement extractor + ledger rules against a PDF, with no database and
 * no R2 — the cheapest way to see what OpenAI makes of a statement. Costs one OpenAI call
 * per 3 pages.
 *
 *   NODE_OPTIONS=--use-system-ca npx ts-node -T scripts/bookkeeping-probe.ts <statement.pdf>
 *
 * (`--use-system-ca` only on the office network, whose TLS proxy re-signs api.openai.com.)
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { basename } from 'path';
import type { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../src/ai/openai.client';
import { buildLedgerRows } from '../src/bookkeeping/ledger.util';
import { StatementExtractor } from '../src/bookkeeping/statement-extractor';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: bookkeeping-probe.ts <statement.pdf>');
  const config = {
    get: (k: string) => process.env[k],
  } as unknown as ConfigService;
  const extractor = new StatementExtractor(new OpenAiClient(config), config);

  const started = Date.now();
  const out = await extractor.extract(readFileSync(file), basename(file));
  const bank = out.accountName ?? 'Bank account';
  const rows = buildLedgerRows(out.transactions, bank);

  console.log(`model=${extractor.model()} ${Date.now() - started}ms`);
  console.log(
    `account="${out.accountName}" period=${out.periodStart}..${out.periodEnd} rows=${rows.length}`,
  );
  console.table(
    rows.map((r) => ({
      posting: r.postingDate?.toISOString().slice(0, 10) ?? '',
      description: r.description.slice(0, 38),
      amount: r.amount,
      debit: r.debitAccount,
      credit: r.creditAccount,
    })),
  );
  const net = rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`net change ${net.toFixed(2)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
