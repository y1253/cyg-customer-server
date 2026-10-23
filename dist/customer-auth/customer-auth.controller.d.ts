import type { Request } from 'express';
import { CustomerAuthService, type AuthResult, type PublicCustomer, type SignupStarted } from './customer-auth.service';
import type { CustomerRequestUser } from './customer-jwt.strategy';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailCodeDto, EmailVerifyDto } from './dto/email-change.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { ResendSignupDto } from './dto/resend-signup.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
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
        turnstileSiteKey: string | null;
    };
    signup(dto: SignupDto, req: Request): Promise<SignupStarted>;
    verifySignup(dto: VerifySignupDto, req: Request): Promise<AuthResult>;
    resendSignup(dto: ResendSignupDto, req: Request): Promise<SignupStarted>;
    login(dto: LoginDto, req: Request): Promise<AuthResult>;
    google(dto: GoogleLoginDto): Promise<AuthResult>;
    forgotPassword(dto: ForgotPasswordDto, req: Request): Promise<SignupStarted>;
    resetPassword(dto: ResetPasswordDto, req: Request): Promise<AuthResult>;
    me(req: AuthedRequest): Promise<PublicCustomer>;
    updateMe(req: AuthedRequest, dto: UpdateMeDto): Promise<PublicCustomer>;
    changePassword(req: AuthedRequest, dto: ChangePasswordDto): Promise<AuthResult>;
    sendPasswordCode(req: AuthedRequest): Promise<SignupStarted>;
    sendEmailCode(req: AuthedRequest, dto: EmailCodeDto): Promise<SignupStarted>;
    verifyEmail(req: AuthedRequest, dto: EmailVerifyDto): Promise<PublicCustomer>;
}
export {};
