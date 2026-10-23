import { Injectable, Logger } from '@nestjs/common';
import type { CommProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  billedMinutes,
  callCost,
  messageCost,
  pricesOf,
  segmentsOf,
  type CommChannel,
  type CommDirection,
  type CommPurpose,
} from './comm-usage.util';

export type ProviderName = 'SIGNALWIRE' | 'WHATSAPP';

/** Who a text / call is for. All optional: a would-be customer has none. */
export interface CommWho {
  customerId?: number | null;
  bookId?: number | null;
  companyId?: number | null;
}

const PROVIDER_CACHE_MS = 10 * 60 * 1000;

/**
 * step12d: records every text, WhatsApp and phone call with a customer and what it cost
 * (`CommMessage` / `CommCall`, priced from `CommProvider`'s list prices — the backfill in
 * `CommPricesService` later swaps in SignalWire's own billed price). Like `AiUsageService`:
 * fire-and-forget, never throws, never slows a send. Providers are cached 10 minutes, so an
 * admin's manual price applies within that.
 */
@Injectable()
export class CommUsageService {
  private readonly logger = new Logger(CommUsageService.name);
  private readonly providers = new Map<
    string,
    { row: CommProvider | null; at: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /** Forget the cached providers (after a price refresh). */
  clearCache(): void {
    this.providers.clear();
  }

  async provider(name: ProviderName): Promise<CommProvider | null> {
    const hit = this.providers.get(name);
    if (hit && Date.now() - hit.at < PROVIDER_CACHE_MS) return hit.row;
    const row = await this.prisma.commProvider.findUnique({ where: { name } });
    this.providers.set(name, { row, at: Date.now() });
    return row;
  }

  /** One text or WhatsApp message. `body` gives the segments when the provider did not. */
  recordMessage(
    m: CommWho & {
      channel: CommChannel;
      direction: CommDirection;
      purpose: CommPurpose;
      providerSid?: string | null;
      from?: string | null;
      to?: string | null;
      segments?: number | null;
      body?: string | null;
      media?: number;
      status?: string | null;
    },
  ): void {
    void this.saveMessage(m).catch((err) =>
      this.logger.warn(
        `${m.channel} ${m.direction} not recorded: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  private async saveMessage(
    m: Parameters<CommUsageService['recordMessage']>[0],
  ): Promise<void> {
    const provider = await this.provider(
      m.channel === 'WHATSAPP' ? 'WHATSAPP' : 'SIGNALWIRE',
    );
    if (!provider) return; // tables not seeded yet
    const media = m.media ?? 0;
    const segments =
      m.channel === 'SMS' && !media
        ? Math.max(1, m.segments ?? segmentsOf(m.body ?? ''))
        : 1;
    const cost = messageCost(pricesOf(provider), {
      channel: m.channel,
      direction: m.direction,
      segments,
      media,
    });
    await this.prisma.commMessage.create({
      data: {
        customerId: m.customerId ?? null,
        bookId: m.bookId ?? null,
        companyId: m.companyId ?? null,
        providerId: provider.id,
        channel: m.channel,
        direction: m.direction,
        purpose: m.purpose,
        providerSid: m.providerSid?.slice(0, 128) || null,
        fromNumber: m.from?.slice(0, 32) ?? null,
        toNumber: m.to?.slice(0, 32) ?? null,
        segments,
        media,
        status: m.status?.slice(0, 16) ?? null,
        costUsd: cost,
      },
    });
  }

  /** A call started (or was placed). Idempotent on `callSid`. */
  callStarted(
    c: CommWho & {
      callSid: string;
      aiCallId?: number | null;
      direction: CommDirection;
      purpose: string;
      from?: string | null;
      to?: string | null;
    },
  ): void {
    void (async () => {
      const provider = await this.provider('SIGNALWIRE');
      if (!provider) return;
      const data = {
        customerId: c.customerId ?? null,
        bookId: c.bookId ?? null,
        companyId: c.companyId ?? null,
        aiCallId: c.aiCallId ?? null,
        direction: c.direction,
        purpose: c.purpose.slice(0, 24),
        fromNumber: c.from?.slice(0, 32) ?? null,
        toNumber: c.to?.slice(0, 32) ?? null,
      };
      await this.prisma.commCall.upsert({
        where: { callSid: c.callSid },
        create: { ...data, callSid: c.callSid, providerId: provider.id },
        update: data,
      });
    })().catch((err) =>
      this.logger.warn(
        `call ${c.callSid} not recorded: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /**
   * A call ended: its length and cost. `recorded` = SignalWire recorded the whole call.
   * A longer duration never gets shortened (the status webhook and the bridge both report).
   */
  callEnded(
    callSid: string,
    e: { durationSec: number; recorded?: boolean },
  ): void {
    void (async () => {
      const row = await this.prisma.commCall.findUnique({
        where: { callSid },
        include: { provider: true },
      });
      if (!row) return;
      const durationSec = Math.max(row.durationSec, Math.round(e.durationSec));
      const recordingSec = e.recorded ? durationSec : row.recordingSec;
      const keepBilled = row.priceSource === 'BILLED';
      await this.prisma.commCall.update({
        where: { id: row.id },
        data: {
          durationSec,
          billedMinutes: billedMinutes(durationSec),
          recordingSec,
          endedAt: row.endedAt ?? new Date(),
          ...(!keepBilled && {
            costUsd: callCost(pricesOf(row.provider), {
              direction: row.direction as CommDirection,
              durationSec,
              recordingSec,
            }),
          }),
        },
      });
    })().catch((err) =>
      this.logger.warn(
        `call ${callSid} end not recorded: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}
