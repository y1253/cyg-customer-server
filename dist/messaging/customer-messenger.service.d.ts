import { ConfigService } from '@nestjs/config';
import { CommUsageService, type CommWho } from '../comm-usage/comm-usage.service';
import type { CommPurpose } from '../comm-usage/comm-usage.util';
import { PrismaService } from '../prisma/prisma.service';
export type MessageChannel = 'SMS' | 'WHATSAPP';
export type SendOutcome = 'sent' | 'opted-out' | 'failed' | 'not-configured';
export type SendMeta = CommWho & {
    purpose: CommPurpose;
};
export declare class CustomerMessenger {
    private readonly prisma;
    private readonly config;
    private readonly usage?;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService, usage?: CommUsageService | undefined);
    private env;
    get smsConfigured(): boolean;
    get whatsappConfigured(): boolean;
    configured(channel: MessageChannel): boolean;
    send(input: {
        channel: MessageChannel;
        to: string;
        body: string;
        from?: string | null;
        meta?: SendMeta;
    }): Promise<SendOutcome>;
    private optedOut;
    private defaultSmsNumber;
    private whatsappIdFor;
    private sendSms;
    private sendWhatsApp;
}
