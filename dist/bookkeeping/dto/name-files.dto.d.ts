export declare class PlaceAttachmentDto {
    name?: string | null;
    folderId?: number | null;
    displayName?: string | null;
}
export declare class CreateNameFolderDto {
    name?: string | null;
    parentId?: number | null;
    title: string;
}
export declare class RenameNameFolderDto {
    title: string;
}
export declare class AddNameDto {
    name: string;
    group?: string | null;
}
export declare class PhoneUploadLinkDto {
    name?: string | null;
    folderId?: number | null;
}
export declare class WelcomeEmailDto {
    to: string;
}
