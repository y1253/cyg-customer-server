import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AiModel } from '@prisma/client';
import {
  currentAiUsage,
  type AiFeature,
  type AiUsageContext,
} from '../ai/ai-usage.context';
import {
  costOf,
  isEmptyUsage,
  parseUsage,
  pricesFromLiteLlm,
  samePrices,
  type ModelPrices,
  type UsageKind,
  type UsageTokens,
} from '../ai/usage.util';
import { PrismaService } from '../prisma/prisma.service';

/** LiteLLM's public price list — OpenAI publishes no pricing API. */
export const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** How long a model's prices are trusted in memory (an admin edit shows within this). */
const MODEL_CACHE_MS = 10 * 60_000;
/** How long the downloaded price list is reused for a new model's first lookup. */
const LIST_CACHE_MS = 24 * 60 * 60_000;

const num = (v: { toString(): string } | null): number | null =>
  v === null ? null : Number(v.toString());

export const pricesOf = (m: AiModel): ModelPrices => ({
  inputPerMTok: num(m.inputPerMTok),
  cachedInputPerMTok: num(m.cachedInputPerMTok),
  outputPerMTok: num(m.outputPerMTok),
  audioInputPerMTok: num(m.audioInputPerMTok),
  audioOutputPerMTok: num(m.audioOutputPerMTok),
  perMinute: num(m.perMinute),
});

/**
 * step12: what each customer costs us in AI. `OpenAiClient` hands every reply's `usage`
 * to `record`, which files one `AiUsage` row (tokens, time, USD) under the customer of the
 * current `withAiUsage` context. A model seen for the first time gets an `AiModel` row,
 * priced from LiteLLM's list; a weekly cron re-checks every price.
 *
 * Never throws: tracking must never break an AI call.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  private readonly models = new Map<
    string,
    { row: AiModel; at: number } | Promise<AiModel>
  >();
  private list: { data: Record<string, unknown>; at: number } | null = null;
  private refreshing = false;

  constructor(private readonly prisma: PrismaService) {}

  /** One OpenAI reply's usage → an `AiUsage` row. Fire-and-forget. */
  record(
    model: string,
    kind: UsageKind,
    usage: unknown,
    durationMs: number,
    /** Overrides the context's feature (a transcription inside an attachment read). */
    feature?: AiFeature,
  ): void {
    // Read the context NOW, while still inside the caller's async scope.
    const outer = currentAiUsage();
    this.recordFor(
      feature ? { ...outer, feature } : outer,
      model,
      kind,
      usage,
      durationMs,
    );
  }

  /** `record` with an explicit context (a phone call's socket events run outside one). */
  recordFor(
    ctx: AiUsageContext,
    model: string,
    kind: UsageKind,
    usage: unknown,
    durationMs: number,
  ): void {
    const tokens = parseUsage(kind, usage);
    if (!tokens || isEmptyUsage(tokens) || !model.trim()) return;
    void this.save(model.trim(), tokens, durationMs, ctx).catch(
      (err: unknown) =>
        this.logger.warn(
          `usage not recorded (${model}): ${err instanceof Error ? err.message : String(err)}`,
        ),
    );
  }

  private async save(
    model: string,
    t: UsageTokens,
    durationMs: number,
    ctx: AiUsageContext,
  ): Promise<void> {
    const row = await this.model(model);
    await this.prisma.aiUsage.create({
      data: {
        customerId: ctx.customerId,
        bookId: ctx.bookId,
        companyId: ctx.companyId,
        feature: ctx.feature,
        modelId: row.id,
        inputTokens: t.input,
        cachedInputTokens: t.cached,
        outputTokens: t.output,
        audioInputTokens: t.audioIn,
        audioOutputTokens: t.audioOut,
        audioSeconds: t.audioSeconds,
        durationMs: Math.max(0, Math.round(durationMs)),
        costUsd: costOf(pricesOf(row), t),
      },
    });
  }

  /** The model's row (cached), created and priced on first use. */
  private async model(name: string): Promise<AiModel> {
    const hit = this.models.get(name);
    if (hit instanceof Promise) return hit;
    if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.row;
    const pending = this.loadModel(name);
    this.models.set(name, pending);
    try {
      const row = await pending;
      this.models.set(name, { row, at: Date.now() });
      return row;
    } catch (err) {
      this.models.delete(name);
      throw err;
    }
  }

  private async loadModel(name: string): Promise<AiModel> {
    const found = await this.prisma.aiModel.findUnique({ where: { name } });
    if (found) return found;
    const prices = await this.lookup(name);
    try {
      return await this.prisma.aiModel.create({
        data: {
          name,
          ...(prices ?? {}),
          priceSource: prices ? 'LITELLM' : 'NONE',
          priceCheckedAt: new Date(),
        },
      });
    } catch {
      // Another call created it first (unique name).
      return this.prisma.aiModel.findUniqueOrThrow({ where: { name } });
    }
  }

  /** A model's prices from the (cached) LiteLLM list; null when unknown or unreachable. */
  private async lookup(
    name: string,
    fresh = false,
  ): Promise<ModelPrices | null> {
    const list = await this.priceList(fresh);
    return list ? pricesFromLiteLlm(list, name) : null;
  }

  private async priceList(
    fresh: boolean,
  ): Promise<Record<string, unknown> | null> {
    if (!fresh && this.list && Date.now() - this.list.at < LIST_CACHE_MS) {
      return this.list.data;
    }
    try {
      const res = await fetch(LITELLM_PRICES_URL, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      this.list = { data, at: Date.now() };
      return data;
    } catch (err) {
      this.logger.warn(
        `price list not fetched: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.list?.data ?? null;
    }
  }

  /**
   * Weekly (Monday 04:00 server time): re-check every model's price against LiteLLM (an
   * admin's MANUAL price is left alone), then price the calls made while a model had none.
   */
  @Cron('0 4 * * 1')
  async refreshPrices(): Promise<{
    checked: number;
    changed: number;
    filled: number;
  }> {
    const out = { checked: 0, changed: 0, filled: 0 };
    if (this.refreshing) return out;
    this.refreshing = true;
    try {
      const list = await this.priceList(true);
      const models = await this.prisma.aiModel.findMany();
      const now = new Date();
      for (const m of models) {
        if (m.priceSource !== 'MANUAL' && list) {
          out.checked++;
          const prices = pricesFromLiteLlm(list, m.name);
          if (prices) {
            const changed = !samePrices(prices, pricesOf(m));
            if (changed) {
              out.changed++;
              this.logger.log(`price of ${m.name} changed (or first found)`);
            }
            await this.prisma.aiModel.update({
              where: { id: m.id },
              data: {
                ...prices,
                priceSource: 'LITELLM',
                priceCheckedAt: now,
                ...(changed && { priceChangedAt: now }),
              },
            });
          } else {
            await this.prisma.aiModel.update({
              where: { id: m.id },
              data: { priceCheckedAt: now },
            });
          }
        }
        this.models.delete(m.name);
      }
      out.filled = await this.fillMissingCosts();
      this.logger.log(
        `prices checked: ${out.checked} model(s), ${out.changed} changed, ${out.filled} call(s) priced`,
      );
    } catch (err) {
      this.logger.error(
        `price refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.refreshing = false;
    }
    return out;
  }

  /** Prices the `AiUsage` rows recorded while their model had no price. */
  private async fillMissingCosts(): Promise<number> {
    let filled = 0;
    const models = await this.prisma.aiModel.findMany({
      where: { priceSource: { not: 'NONE' } },
    });
    for (const m of models) {
      const prices = pricesOf(m);
      for (;;) {
        const rows = await this.prisma.aiUsage.findMany({
          where: { modelId: m.id, costUsd: null },
          take: 500,
        });
        if (!rows.length) break;
        let priced = 0;
        for (const r of rows) {
          const cost = costOf(prices, {
            input: r.inputTokens,
            cached: r.cachedInputTokens,
            output: r.outputTokens,
            audioIn: r.audioInputTokens,
            audioOut: r.audioOutputTokens,
            audioSeconds: r.audioSeconds,
          });
          if (cost === null) continue;
          await this.prisma.aiUsage.update({
            where: { id: r.id },
            data: { costUsd: cost },
          });
          priced++;
        }
        filled += priced;
        if (!priced || rows.length < 500) break;
      }
    }
    return filled;
  }
}
