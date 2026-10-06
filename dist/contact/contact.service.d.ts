import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { CreateContactDto } from './dto/create-contact.dto';
export declare const CONTACT_LIMIT = 5;
export declare const CONTACT_WINDOW_MS: number;
export declare class ContactService {
    private readonly mail;
    private readonly config;
    private readonly logger;
    private readonly hits;
    constructor(mail: MailService, config: ConfigService);
    submit(dto: CreateContactDto, ip: string): Promise<void>;
    private throttle;
}
export declare function buildContactEmail(dto: CreateContactDto): {
    subject: string;
    text: string;
    html: string;
};
