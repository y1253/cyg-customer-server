import { ProspectReplyDto } from './dto/prospect-reply.dto';
import { SalesService, type SalesReply } from './sales.service';
export declare class SalesController {
    private readonly sales;
    constructor(sales: SalesService);
    prospect(dto: ProspectReplyDto): Promise<SalesReply>;
}
