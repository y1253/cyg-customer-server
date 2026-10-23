import type { Request } from 'express';
import { type AuthResult, CustomerAuthService } from './customer-auth.service';
import { PhoneLoginDto, PhoneLoginVerifyDto, PhoneSignupDto } from './dto/phone-login.dto';
import { PhoneAuthService, type PhoneCodeSent, type PhoneSignupResult } from './phone-auth.service';
export declare class PhoneLoginController {
    private readonly phone;
    private readonly auth;
    constructor(phone: PhoneAuthService, auth: CustomerAuthService);
    request(dto: PhoneLoginDto, req: Request): Promise<PhoneCodeSent>;
    verify(dto: PhoneLoginVerifyDto, req: Request): Promise<AuthResult>;
}
export declare class IntakeSignupController {
    private readonly phone;
    constructor(phone: PhoneAuthService);
    signup(dto: PhoneSignupDto): Promise<PhoneSignupResult>;
}
