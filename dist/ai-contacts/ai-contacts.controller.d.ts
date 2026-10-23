import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { AiContactsService, type ContactView } from './ai-contacts.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class AiContactsController {
    private readonly contacts;
    constructor(contacts: AiContactsService);
    list(req: AuthedRequest): Promise<ContactView[]>;
    create(req: AuthedRequest, dto: CreateContactDto): Promise<ContactView>;
    update(req: AuthedRequest, id: number, dto: UpdateContactDto): Promise<ContactView>;
    remove(req: AuthedRequest, id: number): Promise<void>;
}
export {};
