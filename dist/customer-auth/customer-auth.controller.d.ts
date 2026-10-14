import type { Request } from 'express';
import { CustomerAuthService, type AuthResult, type PublicCustomer, type SignupStarted } from './customer-auth.service';
import type { CustomerRequestUser } from './customer-jwt.strategy';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { ResendSignupDto } from './dto/resend-signup.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { VerifySignupDto } from './dto/verify-signup.dto';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class CustomerAuthController {
    private readonly auth;
    constructor(auth: CustomerAuthService);
    config(): {
        googleClientId: string | null;
    };
    signup(dto: SignupDto, req: Request): Promise<SignupStarted>;
    verifySignup(dto: VerifySignupDto, req: Request): Promise<AuthResult>;
    resendSignup(dto: ResendSignupDto): Promise<SignupStarted>;
    login(dto: LoginDto, req: Request): Promise<AuthResult>;
    google(dto: GoogleLoginDto): Promise<AuthResult>;
    me(req: AuthedRequest): Promise<PublicCustomer>;
    updateMe(req: AuthedRequest, dto: UpdateMeDto): Promise<PublicCustomer>;
}
export {};
