import type { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
export declare const FIRST_BOOK_NAME = "Company1";
export interface BookView {
    id: number;
    name: string;
    homeCurrency: string;
}
export declare function listBooks(prisma: PrismaService, customerId: number): Promise<BookView[]>;
export declare function ensureDefaultBook(prisma: PrismaService, customerId: number): Promise<BookScope>;
export declare function ownBook(prisma: PrismaService, customerId: number, bookId: number): Promise<BookScope>;
export declare function businessBook(prisma: PrismaService, customerId: number, companyId: number): Promise<BookScope>;
export declare function companyBook(prisma: PrismaService, companyId: number): Promise<BookScope>;
export declare function legacyBook(prisma: PrismaService, customerId: number, ref: {
    bookId?: number | null;
    companyId?: number | null;
}): Promise<BookScope>;
export declare function bookOwnerName(prisma: PrismaService, scope: BookScope): Promise<string>;
export declare function createBook(prisma: PrismaService, customerId: number, name: string): Promise<BookView>;
export declare function renameBook(prisma: PrismaService, customerId: number, bookId: number, name: string): Promise<BookView>;
