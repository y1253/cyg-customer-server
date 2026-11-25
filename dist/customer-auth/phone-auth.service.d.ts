import { ConfigService } from '@nestjs/config';
import { StripeBillingService } from '../billing/stripe-billing.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAuthService, type AuthResult } from './customer-auth.service';
export interface PhoneCodeSent {
    phone: string;
}
export interface PhoneSignupResult {
    customerId: number;
    created: boolean;
}
export declare class PhoneAuthService {
    private readonly prisma;
    private readonly config;
    private readonly auth;
    private readonly messenger;
    private readonly stripeBilling?;
    private readonly logger;
    private readonly codes;
    private readonly limiter;
    constructor(prisma: PrismaService, config: ConfigService, auth: CustomerAuthService, messenger: CustomerMessenger, stripeBilling?: StripeBillingService | undefined);
    requestCode(rawPhone: string, ip: string): Promise<PhoneCodeSent>;
    verifyCode(rawPhone: string, code: string, ip: string): Promise<AuthResult>;
    signupByPhone(rawPhone: string, createdWith: 'SMS' | 'WHATSAPP' | 'CALL'): Promise<PhoneSignupResult>;
    private linkProspect;
    private parse;
    private prune;
}
