import { Injectable, Logger } from '@nestjs/common';
import type { BookScope } from '../bookkeeping/scope';
import { answerHtml } from '../mail/answer-html';
import { MailService } from '../mail/mail.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';

export type OutboxChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
export const OUTBOX_CHANNELS: readonly OutboxChannel[] = [
  'SMS',
  'WHATSAPP',
  'EMAIL',
];

/** What one send did; `error` is customer-readable (the agent tells them). */
export type OutboxResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

const LABEL: Record<OutboxChannel, string> = {
  SMS: 'text',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'email',
};

/**
 * step12b: the assistant sends something to the customer on ANOTHER channel than the one
 * they are talking on ("email me that", "text me the link"). Only ever to the customer's
 * OWN phone / email — the model never names an address. Every sent message is saved as an
 * ASSISTANT `AiMessage` in that channel's thread, so the Communication tab shows it and the
 * agent remembers it when they answer there.
 *
 * The phone for WhatsApp is the one they last WhatsApped from (Meta only delivers inside
 * the 24-hour window they opened), else their account phone.
 */
@Injectable()
export class CustomerOutbox {
  private readonly logger = new Logger(CustomerOutbox.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: CustomerMessenger,
    private readonly mail: MailService,
  ) {}

  async send(
    scope: BookScope,
    channel: OutboxChannel,
    text: string,
    subject?: string | null,
  ): Promise<OutboxResult> {
    const body = text.trim();
    if (!body) return { ok: false, error: 'There was nothing to send.' };
    const c = await this.prisma.customer.findFirst({
      where: { id: scope.customerId, deletedAt: null },
      select: { email: true, phoneE164: true },
    });
    if (!c) return { ok: false, error: 'The account was not found.' };

    if (channel === 'EMAIL') {
      if (!c.email)
        return {
          ok: false,
          error: 'There is no email address on the account.',
        };
      try {
        await this.mail.send({
          to: c.email,
          subject:
            subject?.trim().slice(0, 150) || 'From your CYG Finance assistant',
          text: body,
          html: answerHtml(body),
          fromName: 'CYG Finance',
        });
      } catch (err) {
        // The SMTP detail is ours, not the customer's business: logged, not told.
        this.logger.warn(
          `assistant email FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          ok: false,
          error: 'The email could not be sent right now. Offer a text instead.',
        };
      }
      await this.log(scope, 'EMAIL', c.email.toLowerCase(), body);
      return { ok: true, to: c.email };
    }

    const to =
      channel === 'WHATSAPP'
        ? ((await this.lastPeer(scope.customerId, 'WHATSAPP')) ?? c.phoneE164)
        : c.phoneE164;
    if (!to)
      return { ok: false, error: 'There is no phone number on the account.' };
    const outcome = await this.messenger.send({ channel, to, body });
    if (outcome !== 'sent') {
      return {
        ok: false,
        error:
          channel === 'WHATSAPP' && outcome === 'failed'
            ? 'The WhatsApp was not delivered — WhatsApp only lets us write within 24 hours of their last WhatsApp to us. Offer a text or an email instead.'
            : `The ${LABEL[channel]} was not sent (${outcome}).`,
      };
    }
    await this.log(scope, channel, to, body);
    return { ok: true, to };
  }

  /** The address / phone the customer last wrote from on a channel. */
  private async lastPeer(
    customerId: number,
    channel: OutboxChannel,
  ): Promise<string | null> {
    const row = await this.prisma.aiConversation.findFirst({
      where: { customerId, channel, peer: { not: null }, attachmentId: null },
      orderBy: { lastMessageAt: 'desc' },
      select: { peer: true },
    });
    return row?.peer ?? null;
  }

  /** Saves the sent message in that channel's thread (a new one starts on this book). */
  private async log(
    scope: BookScope,
    channel: OutboxChannel,
    peer: string,
    text: string,
  ): Promise<void> {
    try {
      const conversation =
        (await this.prisma.aiConversation.findFirst({
          where: {
            customerId: scope.customerId,
            channel,
            peer,
            attachmentId: null,
          },
          orderBy: { id: 'desc' },
        })) ??
        (await this.prisma.aiConversation.create({
          data: {
            customerId: scope.customerId,
            bookId: scope.bookId,
            companyId: scope.companyId,
            channel,
            peer,
            bookChosen: true,
          },
        }));
      await this.prisma.$transaction([
        this.prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            customerId: conversation.customerId,
            bookId: conversation.bookId,
            companyId: conversation.companyId,
            channel,
            role: 'ASSISTANT',
            text: text.slice(0, 20_000),
          },
        }),
        this.prisma.aiConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        `sent ${channel} not logged: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
