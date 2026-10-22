import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentsService } from './attachments.service';
import { BookkeepingService } from './bookkeeping.service';
import { LedgerExportService } from './export.service';
import { ReportsService } from './reports.service';
import type { BookScope } from './scope';
export declare const FILE_LINK_TOKEN_TYPE = "file-link";
export declare const FILE_LINK_TTL_DAYS = 7;
export type FileLinkKind = 'statement' | 'attachment' | 'report' | 'ledger';
export interface FileLinkTarget {
    kind: FileLinkKind;
    id?: number;
    from?: string | null;
    to?: string | null;
    format?: 'pdf' | 'xlsx';
}
export declare class FileLinkService {
    private readonly config;
    private readonly prisma;
    private readonly bookkeeping;
    private readonly attachments;
    private readonly reports;
    private readonly exporter;
    private readonly jwt;
    constructor(config: ConfigService, prisma: PrismaService, bookkeeping: BookkeepingService, attachments: AttachmentsService, reports: ReportsService, exporter: LedgerExportService);
    private base;
    link(scope: BookScope, target: FileLinkTarget): Promise<string>;
    open(token: string): Promise<{
        body: StreamableFile;
        filename: string;
        mimeType: string;
    }>;
    private liveScope;
    ownerName(scope: BookScope): Promise<string>;
}
export declare function linkProblemPage(reason: string): string;
export declare class FileLinkController {
    private readonly links;
    constructor(links: FileLinkService);
    open(token: string, res: Response): Promise<StreamableFile | string>;
}
