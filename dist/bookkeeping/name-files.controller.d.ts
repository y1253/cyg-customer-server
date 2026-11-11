import { AttachmentsService, type AttachmentView } from './attachments.service';
import { AddNameDto, CreateNameFolderDto, PhoneUploadLinkDto, PlaceAttachmentDto, RenameNameFolderDto, WelcomeEmailDto } from './dto/name-files.dto';
import { NameFilesService, type AttachmentEmailView, type NameFolderView } from './name-files.service';
import type { BookScope } from './scope';
import { TaxService } from './tax.service';
export declare class NameFilesController {
    private readonly files;
    private readonly attachments;
    private readonly tax;
    constructor(files: NameFilesService, attachments: AttachmentsService, tax: TaxService);
    place(scope: BookScope, id: number, dto: PlaceAttachmentDto): Promise<AttachmentView>;
    email(scope: BookScope, id: number): Promise<AttachmentEmailView>;
    folders(scope: BookScope): Promise<NameFolderView[]>;
    createFolder(scope: BookScope, dto: CreateNameFolderDto): Promise<NameFolderView[]>;
    renameFolder(scope: BookScope, id: number, dto: RenameNameFolderDto): Promise<NameFolderView[]>;
    removeFolder(scope: BookScope, id: number): Promise<NameFolderView[]>;
    addName(scope: BookScope, dto: AddNameDto): Promise<{
        name: string;
    }>;
    phoneUploadLink(scope: BookScope, dto: PhoneUploadLinkDto): Promise<{
        url: string;
        expiresInMinutes: number;
    }>;
    welcomeEmail(scope: BookScope, dto: WelcomeEmailDto): Promise<{
        ok: boolean;
        message: string;
    }>;
}
export declare class PhoneUploadController {
    private readonly files;
    private readonly attachments;
    constructor(files: NameFilesService, attachments: AttachmentsService);
    info(token: string): Promise<{
        bookName: string;
        name: string | null;
    }>;
    upload(token: string, files: Express.Multer.File[]): Promise<Array<{
        id: number;
        filename: string;
    }>>;
}
