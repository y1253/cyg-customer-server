import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { asE164, smsForm, whatsappTextPayload } from './messaging.util';

export type MessageChannel = 'SMS' | 'WHATSAPP';
export type SendOutcome = 'sent' | 'opted-out' | 'failed' | 'not-configured';

const TIMEOUT_MS = 20_000;

/**
 * step11b: the customer API's OWN way to text or WhatsApp a customer — custom for customers,
 * so the staff app's quoted-reply WhatsApp is never involved (user's decision 2026-10-21).
 * Used for the assistant's replies on the receipt numbers and for scheduled messages.
 *
 * - SMS: SignalWire's Compatibility API (`POST /Messages`, form-encoded), from a receipt
 *   number. A phone that texted STOP (`SmsOptOut`, kept by the internal API) is never texted.
 * - WhatsApp: Meta's Graph API with the firm token, from a receipt number's
 *   `whatsappPhoneNumberId`, as a PLAIN message (no `context`, so no quote). Only inside the
 *   24-hour window the customer opened — callers only reply.
 *
 * Unconfigured (no keys in this server's `.env`) = `configured()` false: callers keep the
 * old path. Never throws; every send answers an outcome.
 */
@Injectable()
export class CustomerMessenger {
  private readonly logger = new Logger(CustomerMessenger.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private env(key: string): string | null {
    return this.config.get<string>(key)?.trim() || null;
  }

  get smsConfigured(): boolean {
    return !!(
      this.env('SIGNALWIRE_PROJECT_ID') &&
      this.env('SIGNALWIRE_API_TOKEN') &&
      this.env('SIGNALWIRE_SPACE_URL')
    );
  }

  get whatsappConfigured(): boolean {
    return !!this.env('WHATSAPP_TOKEN');
  }

  configured(channel: MessageChannel): boolean {
    return channel === 'SMS' ? this.smsConfigured : this.whatsappConfigured;
  }

  /**
   * One message to a customer. `from` = the receipt number (E.164) they wrote to, or — for
   * WhatsApp — its `phone_number_id`; absent = the oldest live receipt number for that channel.
   */
  async send(input: {
    channel: MessageChannel;
    to: string;
    body: string;
    from?: string | null;
  }): Promise<SendOutcome> {
    const to = asE164(input.to);
    if (!to || !input.body.trim()) return 'failed';
    if (!this.configured(input.channel)) return 'not-configured';
    try {
      if (input.channel === 'SMS') {
        if (await this.optedOut(to)) return 'opted-out';
        const from = asE164(input.from) ?? (await this.defaultSmsNumber());
        if (!from) return 'not-configured';
        await this.sendSms(from, to, input.body);
      } else {
        const given = input.from?.trim() || null;
        const phoneNumberId =
          given && !given.startsWith('+')
            ? given
            : await this.whatsappIdFor(given);
        if (!phoneNumberId) return 'not-configured';
        await this.sendWhatsApp(phoneNumberId, to, input.body);
      }
      return 'sent';
    } catch (err) {
      this.logger.warn(
        `${input.channel} to ${mask(to)} FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }

  private async optedOut(phone: string): Promise<boolean> {
    const row = await this.prisma.smsOptOut.findUnique({
      where: { phoneNumber: phone },
      select: { id: true },
    });
    return !!row;
  }

  private async defaultSmsNumber(): Promise<string | null> {
    const n = await this.prisma.intakeNumber.findFirst({
      where: { releasedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { phoneNumber: true },
    });
    return n?.phoneNumber ?? null;
  }

  /** The WhatsApp id of a receipt number (by its E.164), else of the oldest connected one. */
  private async whatsappIdFor(
    e164: string | null | undefined,
  ): Promise<string | null> {
    const number = asE164(e164);
    const n = await this.prisma.intakeNumber.findFirst({
      where: {
        releasedAt: null,
        whatsappStatus: 'CONNECTED',
        whatsappPhoneNumberId: { not: null },
        ...(number ? { phoneNumber: number } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { whatsappPhoneNumberId: true },
    });
    return n?.whatsappPhoneNumberId ?? null;
  }

  private async sendSms(from: string, to: string, body: string): Promise<void> {
    const space = this.env('SIGNALWIRE_SPACE_URL')!
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    const project = this.env('SIGNALWIRE_PROJECT_ID')!;
    const auth = Buffer.from(
      `${project}:${this.env('SIGNALWIRE_API_TOKEN')!}`,
    ).toString('base64');
    const res = await fetch(
      `https://${space}/api/laml/2010-04-01/Accounts/${project}/Messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(smsForm(from, to, body)).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      throw new Error(
        `SignalWire ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
  }

  private async sendWhatsApp(
    phoneNumberId: string,
    to: string,
    body: string,
  ): Promise<void> {
    const version = this.env('WHATSAPP_GRAPH_VERSION') ?? 'v23.0';
    const res = await fetch(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env('WHATSAPP_TOKEN')!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(whatsappTextPayload(to, body)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      throw new Error(
        `WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
  }
}

/** "+15145551234" → "+1514***1234" for logs. */
function mask(phone: string): string {
  return phone.length > 8 ? `${phone.slice(0, 5)}***${phone.slice(-4)}` : '***';
}
