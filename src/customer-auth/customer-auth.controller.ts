import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CustomerAuthService,
  type AuthResult,
  type PublicCustomer,
  type SignupStarted,
} from './customer-auth.service';
import { CustomerJwtGuard } from './customer-jwt.guard';
import type { CustomerRequestUser } from './customer-jwt.strategy';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { ResendSignupDto } from './dto/resend-signup.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { VerifySignupDto } from './dto/verify-signup.dto';

type AuthedRequest = Request & { user: CustomerRequestUser };

/**
 * `/api/customer-auth` — customer accounts for cygfinance.com. There is no logout route:
 * sessions are stateless and signing out is the client discarding its token.
 */
@Controller('customer-auth')
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  /** What the login page needs before it can render the Google button. */
  @Get('config')
  config(): { googleClientId: string | null } {
    return { googleClientId: this.auth.googleClientId() };
  }

  /** Emails a 6-digit code; the account is created by `signup/verify`. */
  @Post('signup')
  @HttpCode(202)
  signup(@Body() dto: SignupDto, @Req() req: Request): Promise<SignupStarted> {
    return this.auth.signup(dto, req.ip ?? 'unknown');
  }

  @Post('signup/verify')
  @HttpCode(200)
  verifySignup(
    @Body() dto: VerifySignupDto,
    @Req() req: Request,
  ): Promise<AuthResult> {
    return this.auth.verifySignup(dto, req.ip ?? 'unknown');
  }

  @Post('signup/resend')
  @HttpCode(202)
  resendSignup(@Body() dto: ResendSignupDto): Promise<SignupStarted> {
    return this.auth.resendSignupCode(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.login(dto, req.ip ?? 'unknown');
  }

  @Post('google')
  @HttpCode(200)
  google(@Body() dto: GoogleLoginDto): Promise<AuthResult> {
    return this.auth.google(dto);
  }

  @Get('me')
  @UseGuards(CustomerJwtGuard)
  me(@Req() req: AuthedRequest): Promise<PublicCustomer> {
    return this.auth.me(req.user.customerId);
  }

  @Patch('me')
  @UseGuards(CustomerJwtGuard)
  updateMe(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateMeDto,
  ): Promise<PublicCustomer> {
    return this.auth.updateMe(req.user.customerId, dto);
  }
}
