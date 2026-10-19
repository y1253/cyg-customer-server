import { PrismaService } from '../prisma/prisma.service';
import { type FxRow, type RateSeries } from './fx.util';
import type { BookScope } from './scope';
export interface FxStatementInfo {
    id: number;
    currency: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
}
export interface FxEntry {
    statementId: number;
    bankAccount: string;
    amount: number;
    home: number;
}
export declare class FxContext {
    readonly home: string;
    private readonly statements;
    private readonly series;
    constructor(home: string, statements: ReadonlyMap<number, FxStatementInfo>, series: ReadonlyMap<string, RateSeries>);
    currencyOf(statementId: number): string;
    isForeign(statementId: number): boolean;
    get anyForeign(): boolean;
    rate(statementId: number, date: string | null): number | null;
    convert(statementId: number, date: string | null, amount: number): {
        home: number;
        rate: number | null;
    };
    revaluations(entries: readonly FxEntry[]): FxRow[];
}
export declare class FxService {
    private readonly prisma;
    private readonly logger;
    private readonly tried;
    constructor(prisma: PrismaService);
    home(scope: BookScope): Promise<string>;
    setHome(scope: BookScope, currency: string): Promise<string>;
    currencies(): readonly string[];
    context(scope: BookScope, statements: readonly FxStatementInfo[]): Promise<FxContext>;
    private series;
    private fetchValet;
}
