import type { AiContact } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export interface ContactView {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    note: string | null;
    lastContactedAt: Date | null;
    createdAt: Date;
}
export interface ContactInput {
    name?: string;
    phone?: string | null;
    email?: string | null;
    note?: string | null;
}
export declare const CONTACT_REPLY_WINDOW_MS: number;
export declare function toContactView(c: AiContact): ContactView;
export declare class AiContactsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    list(customerId: number): Promise<ContactView[]>;
    get(customerId: number, id: number): Promise<AiContact>;
    byPhone(customerId: number, phoneE164: string): Promise<AiContact | null>;
    create(customerId: number, input: ContactInput): Promise<ContactView>;
    update(customerId: number, id: number, input: ContactInput): Promise<ContactView>;
    remove(customerId: number, id: number): Promise<void>;
    save(customerId: number, input: ContactInput): Promise<ContactView>;
    touched(id: number): Promise<void>;
    private clean;
}
