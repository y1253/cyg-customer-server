/**
 * Runs the REAL statement extractor, reconciliation and ledger rules against a PDF, with
 * no database and no R2 — the cheapest way to see what OpenAI makes of a statement and
 * whether it adds up. Costs one OpenAI call per page, plus any re-reads.
 *
 *   NODE_OPTIONS=--use-system-ca npx ts-node -T scripts/bookkeeping-probe.ts <statement.pdf> [--pages=N] [--quiet]
 *
 * `--pages=3` reads three pages per request, which has made gpt-4o drop rows.
 * `--sabotage` deletes one row from page 2's FIRST reading, deterministically — the way to
 * watch the checks catch a dropped row and a real re-read repair it.
 * (`--use-system-ca` only on the office network, whose TLS proxy re-signs api.openai.com.)
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { basename } from 'path';
import type { ConfigService } from '@nestjs/config';
import { OpenAiClient, type ChatRequest } from '../src/ai/openai.client';
import { buildLedgerRows } from '../src/bookkeeping/ledger.util';
import { describeCheck } from '../src/bookkeeping/reconcile.util';
import { StatementExtractor } from '../src/bookkeeping/statement-extractor';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file)
    throw new Error('usage: bookkeeping-probe.ts <statement.pdf> [--pages=N]');
  const pagesArg = process.argv.find((a) => a.startsWith('--pages='));
  const quiet = process.argv.includes('--quiet');
  const config = {
    get: (k: string) => process.env[k],
  } as unknown as ConfigService;
  const client = process.argv.includes('--sabotage')
    ? new SabotagingClient(config)
    : new OpenAiClient(config);
  const extractor = new StatementExtractor(client, config);

  const started = Date.now();
  const out = await extractor.extract(readFileSync(file), basename(file), {
    pagesPerChunk: pagesArg ? Number(pagesArg.split('=')[1]) : undefined,
  });
  const rows = buildLedgerRows(
    out.transactions,
    out.accountName ?? 'Bank account',
  );

  console.log(
    `model=${extractor.model()} verify=${extractor.verifyModel()} ${Date.now() - started}ms, ${out.calls} call(s)`,
  );
  console.log(
    `account="${out.accountName}" bank="${out.bankName}" period=${out.periodStart}..${out.periodEnd} rows=${rows.length}`,
  );
  console.log(`stated: ${JSON.stringify(out.stated)}`);
  console.log(
    `VERIFICATION: ${out.verification.verification} after ${out.rereads} re-read(s)`,
  );
  for (const c of out.verification.checks)
    console.log(
      `  ${c.skipped ? 'skip' : c.ok ? 'ok  ' : 'FAIL'} ${describeCheck(c)}`,
    );
  if (!quiet) {
    console.table(
      rows.slice(0, 12).map((r) => ({
        posting: r.postingDate?.toISOString().slice(0, 10) ?? '',
        description: r.description.slice(0, 34),
        amount: r.amount,
        balance: r.balanceAfter,
        debit: r.debitAccount,
        credit: r.creditAccount,
      })),
    );
  }
}

/** Drops the 5th row from the first reading of page 2 only; re-reads go through untouched. */
class SabotagingClient extends OpenAiClient {
  private sabotaged = false;
  async chat(req: ChatRequest): Promise<string> {
    const reply = await super.chat(req);
    const first =
      Array.isArray(req.user) && req.user[0].type === 'text'
        ? req.user[0].text
        : '';
    if (
      !this.sabotaged &&
      /page 2 of/.test(first) &&
      !/does NOT add up/.test(first)
    ) {
      this.sabotaged = true;
      const parsed = JSON.parse(reply) as { transactions: unknown[] };
      const [gone] = parsed.transactions.splice(4, 1);
      console.log(
        `SABOTAGE: removed from page 2's first reading -> ${JSON.stringify(gone)}`,
      );
      return JSON.stringify(parsed);
    }
    return reply;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
