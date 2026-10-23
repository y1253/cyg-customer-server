import { PrismaService } from '../prisma/prisma.service';
import { CustomerOutbox } from './customer-outbox.service';
export type RelayResult = {
    handled: false;
} | {
    handled: true;
    customerName: string;
};
export declare class ContactRelayService {
    private readonly prisma;
    private readonly outbox;
    private readonly logger;
    constructor(prisma: PrismaService, outbox: CustomerOutbox);
    relay(input: {
        channel: 'SMS' | 'WHATSAPP' | 'CALL';
        phone: string;
        text?: string | null;
    }): Promise<RelayResult>;
}
