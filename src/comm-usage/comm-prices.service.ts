import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { CommProvider } from '@prisma/client';
import { withAiUsage } from '../ai/ai-usage.context';
import { OpenAiClient } from '../ai/openai.client';
import { SignalWireClient } from '../messaging/signalwire.client';
import { PrismaService } from '../prisma/prisma.service';
import { CommUsageService } from './comm-usage.service';
import {
  billedPrice,
  callCost,
  checkPagePrices,
  messageCost,
  pageText,
  PRICE_FIELDS,
  pricesOf,
  samePrices,
  type CommChannel,
  type CommDirection,
  type CommPrices,
} from './comm-usage.util';

/** Rows a backfill run asks SignalWire about at most (one GET each). */
const BACKFILL_BATCH = 200;
/** SignalWire rates a message / call within minutes; past this the list price stays. */
const BACKFILL_WINDOW_MS = 48 * 60 * 60 * 1000;
/** A row younger than this is not asked about yet (not rated). */
const BACKFILL_MIN_AGE_MS = 5 * 60 * 1000;

const PRICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...PRICE_FIELDS],
  properties: Object.fromEntries(
    PRICE_FIELDS.map((k) => [k, { type: ['number', 'null'] }]),
  ),
};

const PRICE_PROMPT = `You read a phone / messaging provider's public pricing page and give its \
pay-as-you-go list prices in US dollars for US and Canadian (+1) LOCAL numbers:
- smsOutPerSegment / smsInPerSegment: one SMS segment sent / received
- mmsOut / mmsIn: one MMS sent / received
- voiceOutPerMin / voiceInPerMin: one minute of an outbound / inbound call to or from a regular phone (PSTN), local number
- recordingPerMin: one minute of call recording
- whatsappOut / whatsappIn: one WhatsApp message sent / received
Give a price only when the page states it; null otherwise. Never guess, never convert from \
another currency, ignore carrier pass-through fees, volume discounts and toll-free numbers. \
Prices are plain numbers in dollars (e.g. 0.00415).`;

/**
 * step12d: keeps text / call costs right.
 * - **Billed prices** (every 10 min): SignalWire rates each message and call soon after it
 *   happens; the row's list-price cost is replaced by SignalWire's own `price` (BILLED).
 * - **List prices** (Monday 04:00, and at start while a provider was never checked): each
 *   non-MANUAL provider's pricing page(s) are read by the AI, the numbers checked
 *   (`checkPagePrices`) and saved; rows still unpriced are then priced. A refused or failed
 *   read keeps the old prices and says why in `priceNote` (the admin sees it).
 */
@Injectable()
export class CommPricesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommPricesService.name);
  private backfilling = false;
  private refreshing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly signalwire: SignalWireClient,
    private readonly openai: OpenAiClient,
    private readonly usage: CommUsageService,
  ) {}

  onApplicationBootstrap(): void {
    // A provider never checked (a fresh install) is read a minute after start.
    setTimeout(() => {
      void this.prisma.commProvider
        .count({
          where: { priceSource: { not: 'MANUAL' }, priceCheckedAt: null },
        })
        .then((n) => (n ? this.refreshPrices() : undefined))
        .catch(() => undefined);
    }, 60_000).unref();
  }

  @Cron('*/10 * * * *')
  async backfillBilled(): Promise<number> {
    if (this.backfilling || !this.signalwire.configured) return 0;
    this.backfilling = true;
    let updated = 0;
    try {
      const provider = await this.prisma.commProvider.findUnique({
        where: { name: 'SIGNALWIRE' },
      });
      if (!provider) return 0;
      const now = Date.now();
      const window = {
        gte: new Date(now - BACKFILL_WINDOW_MS),
        lte: new Date(now - BACKFILL_MIN_AGE_MS),
      };
      const messages = await this.prisma.commMessage.findMany({
        where: {
          providerId: provider.id,
          priceSource: 'LIST',
          providerSid: { not: null },
          createdAt: window,
        },
        orderBy: { id: 'asc' },
        take: BACKFILL_BATCH,
      });
      for (const m of messages) {
        const b = await this.signalwire.billed('Messages', m.providerSid!);
        const price = billedPrice(b?.price);
        if (price === null) continue;
        await this.prisma.commMessage.update({
          where: { id: m.id },
          data: {
            costUsd: price,
            priceSource: 'BILLED',
            ...(b?.segments ? { segments: b.segments } : {}),
            ...(b?.status ? { status: b.status.slice(0, 16) } : {}),
          },
        });
        updated++;
      }
      const calls = await this.prisma.commCall.findMany({
        where: {
          providerId: provider.id,
          priceSource: 'LIST',
          endedAt: { not: null },
          createdAt: window,
        },
        orderBy: { id: 'asc' },
        take: BACKFILL_BATCH,
      });
      for (const c of calls) {
        const b = await this.signalwire.billed('Calls', c.callSid);
        const price = billedPrice(b?.price);
        if (price === null) continue;
        // SignalWire's call price is the minutes only; the recording stays at list price.
        const recording =
          Math.ceil(c.recordingSec / 60) *
          Number(provider.recordingPerMin ?? 0);
        await this.prisma.commCall.update({
          where: { id: c.id },
          data: {
            costUsd: Math.round((price + recording) * 1e6) / 1e6,
            priceSource: 'BILLED',
          },
        });
        updated++;
      }
      if (updated)
        this.logger.log(`${updated} text(s)/call(s) given their billed price`);
    } catch (err) {
      this.logger.warn(
        `billed-price backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.backfilling = false;
    }
    return updated;
  }

  @Cron('0 4 * * 1')
  async refreshPrices(): Promise<{
    checked: number;
    changed: number;
    priced: number;
  }> {
    const out = { checked: 0, changed: 0, priced: 0 };
    if (this.refreshing) return out;
    this.refreshing = true;
    try {
      const providers = await this.prisma.commProvider.findMany();
      for (const p of providers) {
        if (p.priceSource === 'MANUAL') continue;
        out.checked++;
        if (await this.refreshOne(p)) out.changed++;
      }
      this.usage.clearCache();
      out.priced = await this.priceMissing();
      this.logger.log(
        `phone/text prices checked: ${out.checked} provider(s), ${out.changed} changed, ${out.priced} row(s) priced`,
      );
    } catch (err) {
      this.logger.error(
        `phone/text price refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.refreshing = false;
    }
    return out;
  }

  /** One provider's pages → its prices. True when a price changed. */
  private async refreshOne(p: CommProvider): Promise<boolean> {
    const now = new Date();
    const current = pricesOf(p);
    const note = async (priceNote: string) => {
      this.logger.warn(`${p.name} prices not updated: ${priceNote}`);
      await this.prisma.commProvider.update({
        where: { id: p.id },
        data: { priceCheckedAt: now, priceNote: priceNote.slice(0, 1000) },
      });
      return false;
    };
    const urls = [p.pricingUrl, p.voicePricingUrl].filter(
      (u): u is string => !!u,
    );
    if (!urls.length) return note('no pricing page set');
    if (!this.openai.configured) return note('the AI is not configured');

    const texts: string[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (CYG Finance price check)' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) return note(`${url} answered ${res.status}`);
        texts.push(`PAGE ${url}:\n${pageText(await res.text(), 40_000)}`);
      } catch (err) {
        return note(
          `${url} could not be read: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let read: Partial<CommPrices>;
    try {
      const reply = await withAiUsage({ feature: 'OTHER' }, () =>
        this.openai.chat({
          model:
            this.config.get<string>('OPENAI_BOOKKEEPING_TAX_MODEL')?.trim() ||
            'gpt-4.1-mini',
          system: PRICE_PROMPT,
          user: `Provider: ${p.label}\n\n${texts.join('\n\n')}`,
          jsonSchema: { name: 'comm_prices', schema: PRICE_SCHEMA },
          maxTokens: 400,
          timeoutMs: 90_000,
        }),
      );
      read = JSON.parse(reply) as Partial<CommPrices>;
    } catch (err) {
      return note(
        `the AI could not read the page: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // A provider we only text through has no voice prices to read, and vice versa: keep
    // the fields this provider does not sell from overwriting anything.
    const checked = checkPagePrices(read, current);
    if (!checked.ok) return note(checked.reason);
    const changed = !samePrices(checked.prices, current);
    const found = PRICE_FIELDS.filter((k) => read[k] != null)
      .map((k) => `${k} ${read[k]}`)
      .join(', ');
    await this.prisma.commProvider.update({
      where: { id: p.id },
      data: {
        ...checked.prices,
        priceSource: 'AUTO',
        priceCheckedAt: now,
        ...(changed && { priceChangedAt: now }),
        priceNote: `Read ${now.toISOString().slice(0, 10)}: ${found}`.slice(
          0,
          1000,
        ),
      },
    });
    if (changed) this.logger.log(`${p.name} prices changed (or first found)`);
    return changed;
  }

  /** Rows saved while their provider had no price for them. */
  async priceMissing(): Promise<number> {
    let priced = 0;
    const providers = await this.prisma.commProvider.findMany();
    for (const p of providers) {
      const prices = pricesOf(p);
      const messages = await this.prisma.commMessage.findMany({
        where: { providerId: p.id, costUsd: null },
        take: 5000,
      });
      for (const m of messages) {
        const cost = messageCost(prices, {
          channel: m.channel as CommChannel,
          direction: m.direction as CommDirection,
          segments: m.segments,
          media: m.media,
        });
        if (cost === null) continue;
        await this.prisma.commMessage.update({
          where: { id: m.id },
          data: { costUsd: cost },
        });
        priced++;
      }
      const calls = await this.prisma.commCall.findMany({
        where: { providerId: p.id, costUsd: null, endedAt: { not: null } },
        take: 5000,
      });
      for (const c of calls) {
        const cost = callCost(prices, {
          direction: c.direction as CommDirection,
          durationSec: c.durationSec,
          recordingSec: c.recordingSec,
        });
        if (cost === null) continue;
        await this.prisma.commCall.update({
          where: { id: c.id },
          data: { costUsd: cost },
        });
        priced++;
      }
    }
    return priced;
  }
}
