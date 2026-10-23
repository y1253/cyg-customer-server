import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { type BookView } from './books';
import { BookNameDto } from './dto/book.dto';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class BooksController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    list(req: AuthedRequest): Promise<BookView[]>;
    create(req: AuthedRequest, dto: BookNameDto): Promise<BookView>;
    rename(req: AuthedRequest, id: number, dto: BookNameDto): Promise<BookView>;
}
export {};
