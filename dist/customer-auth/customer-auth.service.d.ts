import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CustomerAuthType, CustomerCreatedWith, type Customer } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { GoogleLoginDto } from './dto/google-login.dto';
import type { LoginDto } from './dto/login.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { ResendSignupDto } from './dto/resend-signup.dto';
import type { SignupDto } from './dto/signup.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import type { VerifySignupDto } from './dto/verify-signup.dto';
export declare const CUSTOMER_TOKEN_TYPE = "customer";
export interface CustomerJwtPayload {
    sub: number;
    email: string | null;
    name: string;
    typ: typeof CUSTOMER_TOKEN_TYPE;
    iat?: number;
}
export interface PublicCustomer {
    id: number;
    name: string;
    email: string | null;
    authType: CustomerAuthType;
    createdWith: CustomerCreatedWith | null;
    hasPassword: boolean;
    avatarUrl: string | null;
    phone: string | null;
    preferredContact: string | null;
    transactionAlerts: boolean;
    createdAt: Date;
}
export interface AuthResult {
    access_token: string;
    customer: PublicCustomer;
}
export interface GoogleIdentity {
    email: string;
    emailVerified: boolean;
    name: string | null;
    picture: string | null;
}
export declare const AUTH_LIMIT = 5;
export declare const AUTH_WINDOW_MS: number;
export declare const SIGNUP_CODE_TTL_MS: number;
export declare const SIGNUP_CODE_TRIES = 5;
export declare const SIGNUP_RESEND_MS = 60000;
export interface SignupStarted {
    email: string;
}
export declare function toPublicCustomer(c: Customer): PublicCustomer;
export declare class CustomerAuthService {
    private readonly prisma;
    private readonly jwt;
    private readonly config;
    private readonly mail;
    private readonly logger;
    private readonly hits;
    private readonly pending;
    private readonly resets;
    private readonly emailCodes;
    private googleClient;
    private readonly codeMails;
    constructor(prisma: PrismaService, jwt: JwtService, config: ConfigService, mail: MailService);
    turnstileSiteKey(): string | null;
    verifyHuman(token: string | undefined, ip: string): Promise<void>;
    googleClientId(): string | null;
    signup(dto: SignupDto, ip: string): Promise<SignupStarted>;
    verifySignup(dto: VerifySignupDto, ip: string): Promise<AuthResult>;
    resendSignupCode(dto: ResendSignupDto, ip: string): Promise<SignupStarted>;
    private livePending;
    private assertEmailFree;
    private sendCode;
    private prunePending;
    forgotPassword(dto: ForgotPasswordDto, ip: string): Promise<SignupStarted>;
    resetPassword(dto: ResetPasswordDto, ip: string): Promise<AuthResult>;
    changePassword(customerId: number, dto: ChangePasswordDto, ip: string): Promise<AuthResult>;
    sendPasswordCode(customerId: number, ip: string): Promise<SignupStarted>;
    sendEmailCode(customerId: number, rawEmail: string, ip: string): Promise<SignupStarted>;
    verifyEmail(customerId: number, rawEmail: string, code: string, ip: string): Promise<PublicCustomer>;
    private issuePasswordCode;
    private checkPasswordCode;
    private passwordData;
    login(dto: LoginDto, ip: string): Promise<AuthResult>;
    google(dto: GoogleLoginDto): Promise<AuthResult>;
    findActive(id: number): Promise<Customer | null>;
    me(id: number): Promise<PublicCustomer>;
    updateMe(id: number, dto: UpdateMeDto): Promise<PublicCustomer>;
    verifyGoogleCredential(credential: string): Promise<GoogleIdentity>;
    phoneTaken(phoneE164: string, exceptId?: number): Promise<boolean>;
    issueFor(customer: Customer): Promise<AuthResult>;
    private issue;
    private sign;
    throttle(ip: string): void;
    note(ip: string): void;
}
