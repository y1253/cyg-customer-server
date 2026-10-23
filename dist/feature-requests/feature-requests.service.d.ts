import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from '../schedules/schedules.service';
export interface FeatureRequestView {
    id: number;
    summary: string;
    request: string;
    status: string;
    staffNote: string | null;
    channel: string;
    book: string | null;
    createdAt: string;
    updatedAt: string;
    doneAt: string | null;
}
export declare class FeatureRequestsService {
    private readonly prisma;
    private readonly messenger;
    private readonly schedules;
    private readonly logger;
    private ticking;
    constructor(prisma: PrismaService, messenger: CustomerMessenger, schedules: SchedulesService);
    listForCustomer(customerId: number): Promise<FeatureRequestView[]>;
    tick(): Promise<void>;
    private notify;
}
