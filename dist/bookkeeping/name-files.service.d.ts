import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
export interface NameFolderView {
    id: number;
    nameKey: string;
    parentId: number | null;
    title: string;
}
export interface AttachmentEmailView {
    from: string | null;
    to: string | null;
    subject: string | null;
    receivedAt: Date | null;
    text: string | null;
    html: string | null;
    partial: boolean;
    files: Array<{
        id: number;
        filename: string;
        mimeType: string;
    }>;
}
export declare const PHONE_UPLOAD_TOKEN_TYPE = "phone-upload";
export declare const CUSTOMER_SYSTEM_TOKEN_TYPE = "customer-system";
export interface PhoneUploadClaims {
    typ: typeof PHONE_UPLOAD_TOKEN_TYPE;
    sub: number;
    bookId: number;
    name?: string;
    folderId?: number;
}
export declare class NameFilesService {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    private readonly jwt;
    private readonly welcomeSent;
    constructor(prisma: PrismaService, config: ConfigService);
    folders(scope: BookScope): Promise<NameFolderView[]>;
    createFolder(scope: BookScope, name: string | null, parentId: number | null, rawTitle: string): Promise<NameFolderView[]>;
    renameFolder(scope: BookScope, id: number, rawTitle: string): Promise<NameFolderView[]>;
    removeFolder(scope: BookScope, id: number): Promise<NameFolderView[]>;
    private folder;
    email(scope: BookScope, id: number): Promise<AttachmentEmailView>;
    phoneUploadLink(scope: BookScope, place: {
        name?: string | null;
        folderId?: number | null;
    }): Promise<{
        url: string;
        expiresInMinutes: number;
    }>;
    phoneUploadTarget(token: string): Promise<{
        scope: BookScope;
        name: string | null;
        folderId: number | null;
        bookName: string;
    }>;
    welcomeEmail(scope: BookScope, rawTo: string): Promise<{
        ok: boolean;
        message: string;
    }>;
}
