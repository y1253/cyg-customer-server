import { CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from './scope';
export declare function parseCompanyParam(raw: unknown): number | null;
export declare class BookScopeGuard implements CanActivate {
    private readonly prisma;
    constructor(prisma: PrismaService);
    canActivate(ctx: ExecutionContext): Promise<boolean>;
    resolve(customerId: number, raw: unknown): Promise<BookScope>;
}
export declare const Book: (...dataOrPipes: unknown[]) => ParameterDecorator;
