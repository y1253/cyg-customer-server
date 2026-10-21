import { type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { BookScope } from '../bookkeeping/scope';
import { BankFeedsService, type BankConnectionView } from './bank-feeds.service';
import { ExchangeDto, StartDatesDto } from './dto/bank-feeds.dto';
export declare class BankFeedsController {
    private readonly feeds;
    constructor(feeds: BankFeedsService);
    config(): {
        enabled: boolean;
    };
    list(scope: BookScope): Promise<BankConnectionView[]>;
    linkToken(scope: BookScope, itemId?: string, accounts?: string): Promise<{
        linkToken: string;
    }>;
    exchange(scope: BookScope, dto: ExchangeDto): Promise<BankConnectionView>;
    reconnected(scope: BookScope, id: number): Promise<BankConnectionView>;
    setStartDates(scope: BookScope, id: number, dto: StartDatesDto): Promise<BankConnectionView>;
    refresh(scope: BookScope, id: number): Promise<BankConnectionView>;
    remove(scope: BookScope, id: number): Promise<void>;
}
export declare class PlaidWebhookController {
    private readonly feeds;
    private readonly logger;
    constructor(feeds: BankFeedsService);
    webhook(req: RawBodyRequest<Request>, token: string | undefined): Promise<{
        received: true;
    }>;
}
