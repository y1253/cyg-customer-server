import { type StaffBook } from '../bookkeeping/staff-book.guard';
import { BankFeedsService, type BankConnectionView } from './bank-feeds.service';
import { ExchangeDto, StartDatesDto } from './dto/bank-feeds.dto';
export declare class StaffBankFeedsController {
    private readonly feeds;
    private readonly logger;
    constructor(feeds: BankFeedsService);
    config(): {
        enabled: boolean;
    };
    list(staff: StaffBook): Promise<BankConnectionView[]>;
    linkToken(_companyId: number, staff: StaffBook, itemId?: string, accounts?: string): Promise<{
        linkToken: string;
    }>;
    exchange(_companyId: number, staff: StaffBook, dto: ExchangeDto): Promise<BankConnectionView>;
    reconnected(staff: StaffBook, id: number): Promise<BankConnectionView>;
    setStartDates(staff: StaffBook, id: number, dto: StartDatesDto): Promise<BankConnectionView>;
    refresh(staff: StaffBook, id: number): Promise<BankConnectionView>;
    remove(staff: StaffBook, id: number): Promise<void>;
    private log;
}
