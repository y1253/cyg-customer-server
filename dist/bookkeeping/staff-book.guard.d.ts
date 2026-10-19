import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from './scope';
export declare const STAFF_BOOK_TOKEN_TYPE = "staff-book";
export interface StaffBookPayload {
    typ: string;
    sub: number;
    companyId: number;
    canEdit: boolean;
}
export interface StaffBook {
    scope: BookScope;
    staffUserId: number;
    canEdit: boolean;
}
export declare class StaffBookGuard implements CanActivate {
    private readonly prisma;
    private readonly jwt;
    constructor(config: ConfigService, prisma: PrismaService);
    canActivate(ctx: ExecutionContext): Promise<boolean>;
    private verify;
    scopeOf(companyId: number): Promise<BookScope>;
}
export declare const Staff: (...dataOrPipes: unknown[]) => ParameterDecorator;
