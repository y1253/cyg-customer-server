export declare class CustomColumnOptionDto {
    id?: number;
    label: string;
}
export declare class CustomColumnDto {
    name: string;
    type: string;
    minChars?: number | null;
    maxChars?: number | null;
    required?: boolean;
    options?: CustomColumnOptionDto[];
}
export declare class CopyCustomColumnsDto {
    fromBookId: number;
}
export declare class CustomAnswerDto {
    value?: string | null;
    dropDownId?: number | null;
}
export declare class CustomColumnOrderDto {
    ids: number[];
}
