import { StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CustomerAuthService } from '../customer-auth/customer-auth.service';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { BookkeepingService, type StatementView, type TransactionView } from './bookkeeping.service';
import { type ChartAccount } from './chart-of-accounts';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { LedgerExportService } from './export.service';
import { ReportsService } from './reports.service';
import type { ReportsView } from './reports.util';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class BookkeepingController {
    private readonly bookkeeping;
    private readonly exporter;
    private readonly customers;
    private readonly reportsService;
    constructor(bookkeeping: BookkeepingService, exporter: LedgerExportService, customers: CustomerAuthService, reportsService: ReportsService);
    upload(req: AuthedRequest, files: Express.Multer.File[]): Promise<StatementView[]>;
    list(req: AuthedRequest): Promise<StatementView[]>;
    transactions(req: AuthedRequest, statementIds?: string): Promise<TransactionView[]>;
    file(req: AuthedRequest, id: number, res: Response): Promise<StreamableFile>;
    retry(req: AuthedRequest, id: number): Promise<StatementView>;
    remove(req: AuthedRequest, id: number): Promise<void>;
    export(req: AuthedRequest, format: string, res: Response): Promise<StreamableFile>;
    reports(req: AuthedRequest, q: ReportsQueryDto): Promise<ReportsView>;
    accounts(): readonly ChartAccount[];
}
export {};
