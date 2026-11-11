import { PrismaService } from '../prisma/prisma.service';
import { type ColumnInput, type CustomColumnType } from './custom-column.util';
import { type BookScope } from './scope';
export interface CustomColumnView {
    id: number;
    name: string;
    type: CustomColumnType;
    minChars: number | null;
    maxChars: number | null;
    required: boolean;
    options: Array<{
        id: number;
        label: string;
    }>;
}
export interface CustomAnswerView {
    value: string | null;
    dropDownId: number | null;
}
export interface CustomColumnsView {
    columns: CustomColumnView[];
    answers: Record<number, Record<number, CustomAnswerView>>;
    templates: Array<{
        bookId: number;
        bookName: string;
        columns: Array<{
            name: string;
            type: CustomColumnType;
            options: number;
        }>;
    }>;
}
export declare class CustomColumnsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    view(scope: BookScope): Promise<CustomColumnsView>;
    columns(scope: BookScope): Promise<CustomColumnView[]>;
    private templates;
    private clean;
    private nameTaken;
    create(scope: BookScope, input: ColumnInput): Promise<void>;
    private owned;
    update(scope: BookScope, id: number, input: ColumnInput): Promise<void>;
    remove(scope: BookScope, id: number): Promise<void>;
    reorder(scope: BookScope, ids: number[]): Promise<void>;
    copy(scope: BookScope, fromBookId: number): Promise<number>;
    answer(scope: BookScope, transactionIds: number[], columnId: number, input: {
        value?: string | null;
        dropDownId?: number | null;
        option?: string;
    }): Promise<number>;
    exportCells(scope: BookScope): Promise<{
        columns: CustomColumnView[];
        cells: Map<number, string[]>;
    }>;
}
