import { PrismaService } from '../prisma/prisma.service';
import { type ColumnInput, type CustomColumnType } from './custom-column.util';
import { type BookScope } from './scope';
export type QboColumnKind = 'CLASS' | 'FIELD' | 'LOCATION' | 'CUSTOMER';
export declare const QBO_COLUMN_KINDS: readonly QboColumnKind[];
export declare const qboColumnKind: (v: unknown) => QboColumnKind | null;
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
    qbo: QboColumnKind | null;
}
export interface CustomAnswerView {
    value: string | null;
    dropDownId: number | null;
}
export interface CustomNameAnswerView extends CustomAnswerView {
    columnId: number;
    name: string | null;
    subNameId: number | null;
}
export interface CustomColumnsView {
    columns: CustomColumnView[];
    answers: Record<number, Record<number, CustomAnswerView>>;
    nameAnswers: CustomNameAnswerView[];
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
    private nameAnswers;
    columns(scope: BookScope): Promise<CustomColumnView[]>;
    private templates;
    private clean;
    private nameTaken;
    create(scope: BookScope, input: ColumnInput): Promise<void>;
    private owned;
    update(scope: BookScope, id: number, input: ColumnInput): Promise<void>;
    private fitNameAnswers;
    private checkAnswers;
    remove(scope: BookScope, id: number): Promise<void>;
    reorder(scope: BookScope, ids: number[]): Promise<void>;
    copy(scope: BookScope, fromBookId: number): Promise<number>;
    answer(scope: BookScope, transactionIds: number[], columnId: number, input: {
        value?: string | null;
        dropDownId?: number | null;
        option?: string;
    }): Promise<number>;
    fillEmpty(scope: BookScope, columnId: number, cells: ReadonlyArray<{
        transactionId: number;
        value: string;
    }>): Promise<number>;
    ensureQboColumn(scope: BookScope, col: {
        kind: QboColumnKind;
        ref: string | null;
        name: string;
        options: string[];
    }): Promise<number>;
    setNameAnswer(scope: BookScope, columnId: number, target: {
        name?: string;
        subNameId?: number;
    }, input: {
        value?: string | null;
        dropDownId?: number | null;
        option?: string;
    }): Promise<number>;
    private checkedValue;
    exportCells(scope: BookScope): Promise<{
        columns: CustomColumnView[];
        cells: Map<number, string[]>;
    }>;
}
