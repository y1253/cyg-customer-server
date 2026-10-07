import type { Request } from 'express';
import { CustomerAuthService, type AuthResult, type PublicCustomer } from './customer-auth.service';
import type { CustomerRequestUser } from './customer-jwt.strategy';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateMeDto } from './dto/update-me.dto';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class CustomerAuthController {
    private readonly auth;
    constructor(auth: CustomerAuthService);
    config(): {
        googleClientId: string | null;
    };
    signup(dto: SignupDto, req: Request): Promise<AuthResult>;
    login(dto: LoginDto, req: Request): Promise<AuthResult>;
    google(dto: GoogleLoginDto): Promise<AuthResult>;
    me(req: AuthedRequest): Promise<PublicCustomer>;
    updateMe(req: AuthedRequest, dto: UpdateMeDto): Promise<PublicCustomer>;
}
export {};
