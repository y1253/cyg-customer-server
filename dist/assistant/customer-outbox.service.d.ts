import type { BookScope } from '../bookkeeping/scope';
import type { CommPurpose } from '../comm-usage/comm-usage.util';
import { MailService } from '../mail/mail.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
export type OutboxChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
export declare const OUTBOX_CHANNELS: readonly OutboxChannel[];
export type OutboxResult = {
    ok: true;
    to: string;
} | {
    ok: false;
    error: string;
};
export declare class CustomerOutbox {
    private readonly prisma;
    private readonly messenger;
    private readonly mail;
    private readonly logger;
    constructor(prisma: PrismaService, messenger: CustomerMessenger, mail: MailService);
    send(scope: BookScope, channel: OutboxChannel, text: string, subject?: string | null, purpose?: CommPurpose): Promise<OutboxResult>;
    private lastPeer;
    private log;
}
