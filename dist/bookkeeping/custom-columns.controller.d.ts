import { CustomColumnsService, type CustomColumnsView } from './custom-columns.service';
import { CopyCustomColumnsDto, CustomAnswerDto, CustomColumnDto, CustomColumnOrderDto, CustomNameAnswerDto } from './dto/custom-column.dto';
import type { BookScope } from './scope';
import { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
export declare class CustomColumnsController {
    private readonly columns;
    private readonly qbo;
    constructor(columns: CustomColumnsService, qbo: QuickBooksSyncService);
    view(scope: BookScope): Promise<CustomColumnsView>;
    create(scope: BookScope, dto: CustomColumnDto): Promise<CustomColumnsView>;
    copy(scope: BookScope, dto: CopyCustomColumnsDto): Promise<CustomColumnsView>;
    reorder(scope: BookScope, dto: CustomColumnOrderDto): Promise<CustomColumnsView>;
    update(scope: BookScope, id: number, dto: CustomColumnDto): Promise<CustomColumnsView>;
    remove(scope: BookScope, id: number): Promise<CustomColumnsView>;
    answer(scope: BookScope, id: number, columnId: number, dto: CustomAnswerDto): Promise<CustomColumnsView>;
    nameAnswer(scope: BookScope, id: number, dto: CustomNameAnswerDto): Promise<CustomColumnsView>;
}
