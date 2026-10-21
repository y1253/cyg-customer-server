import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export type MessageChannel = 'SMS' | 'WHATSAPP';
export type SendOutcome = 'sent' | 'opted-out' | 'failed' | 'not-configured';
export declare class CustomerMessenger {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService);
    private env;
    get smsConfigured(): boolean;
    get whatsappConfigured(): boolean;
    configured(channel: MessageChannel): boolean;
    send(input: {
        channel: MessageChannel;
        to: string;
        body: string;
        from?: string | null;
    }): Promise<SendOutcome>;
    private optedOut;
    private defaultSmsNumber;
    private whatsappIdFor;
    private sendSms;
    private sendWhatsApp;
}
