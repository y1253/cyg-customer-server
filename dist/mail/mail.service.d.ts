import { ConfigService } from '@nestjs/config';
export declare class MailService {
    private readonly config;
    private readonly logger;
    private transporter;
    constructor(config: ConfigService);
    get configured(): boolean;
    send(opts: {
        to: string;
        subject: string;
        text: string;
        html?: string;
        replyTo?: string;
    }): Promise<void>;
    private user;
    private pass;
    private transport;
}
