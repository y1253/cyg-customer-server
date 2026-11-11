import { CustomColumnsService, type CustomColumnsView } from './custom-columns.service';
import { CopyCustomColumnsDto, CustomAnswerDto, CustomColumnDto, CustomColumnOrderDto } from './dto/custom-column.dto';
import type { BookScope } from './scope';
export declare class CustomColumnsController {
    private readonly columns;
    constructor(columns: CustomColumnsService);
    view(scope: BookScope): Promise<CustomColumnsView>;
    create(scope: BookScope, dto: CustomColumnDto): Promise<CustomColumnsView>;
    copy(scope: BookScope, dto: CopyCustomColumnsDto): Promise<CustomColumnsView>;
    reorder(scope: BookScope, dto: CustomColumnOrderDto): Promise<CustomColumnsView>;
    update(scope: BookScope, id: number, dto: CustomColumnDto): Promise<CustomColumnsView>;
    remove(scope: BookScope, id: number): Promise<CustomColumnsView>;
    answer(scope: BookScope, id: number, columnId: number, dto: CustomAnswerDto): Promise<CustomColumnsView>;
}
