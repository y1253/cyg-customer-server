import { Injectable, Logger } from '@nestjs/common';
import { CONTACT_REPLY_WINDOW_MS } from '../ai-contacts/ai-contacts.service';
import { ensureDefaultBook } from '../bookkeeping/books';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerOutbox, type OutboxChannel } from './customer-outbox.service';

/** What `relay` did: `customerName` = who it was passed to (the call says it). */
export type RelayResult =
  | { handled: false }
  | { handled: true; customerName: string };

/**
 * step12c: someone the AI called or texted for a customer (an `AiContact`) answers — texts
 * back, WhatsApps, or calls our number. Within 72 h of the AI's last call / text, it is
 * passed to that customer on their preferred channel ("John replied: …") instead of the
 * unknown-number sign-up offer. Called by the internal API (`IntakeSystemGuard`).
 */
@Injectable()
export class ContactRelayService {
  private readonly logger = new Logger(ContactRelayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: CustomerOutbox,
  ) {}

  async relay(input: {
    channel: 'SMS' | 'WHATSAPP' | 'CALL';
    phone: string;
    text?: string | null;
  }): Promise<RelayResult> {
    const contact = await this.prisma.aiContact.findFirst({
      where: {
        phoneE164: input.phone,
        deletedAt: null,
        lastContactedAt: {
          gte: new Date(Date.now() - CONTACT_REPLY_WINDOW_MS),
        },
        customer: { deletedAt: null },
      },
      orderBy: { lastContactedAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneE164: true,
            preferredContact: true,
          },
        },
      },
    });
    if (!contact) return { handled: false };
    const words = input.text?.trim();
    const text =
      input.channel === 'CALL'
        ? `${contact.name} (${input.phone}) called back. You can ask me to call or text them.`
        : words
          ? `${contact.name} replied: "${words.slice(0, 1500)}"`
          : `${contact.name} (${input.phone}) sent a message with no text.`;
    const c = contact.customer;
    const preferred = c.preferredContact;
    const order: OutboxChannel[] = [
      ...(preferred === 'EMAIL' ||
      preferred === 'WHATSAPP' ||
      preferred === 'SMS'
        ? [preferred as OutboxChannel]
        : []),
      ...(c.phoneE164 ? (['SMS'] as const) : []),
      ...(c.email ? (['EMAIL'] as const) : []),
    ];
    const scope = await ensureDefaultBook(this.prisma, c.id);
    for (const channel of [...new Set(order)]) {
      const sent = await this.outbox.send(scope, channel, text);
      if (sent.ok) {
        this.logger.log(
          `contact #${contact.id} ${input.channel} relayed to customer #${c.id} by ${channel}`,
        );
        return { handled: true, customerName: c.name.trim() || 'our client' };
      }
    }
    this.logger.warn(
      `contact #${contact.id} reply NOT relayed to customer #${c.id} (no channel worked)`,
    );
    // Still theirs: never offer a sign-up to someone a customer is talking to.
    return { handled: true, customerName: c.name.trim() || 'our client' };
  }
}
