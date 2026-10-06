import type { Request } from 'express';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';
export declare class ContactController {
    private readonly contact;
    constructor(contact: ContactService);
    create(dto: CreateContactDto, req: Request): Promise<{
        ok: true;
    }>;
}
