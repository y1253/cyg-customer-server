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
  config(): {
    googleClientId: string | null;
    turnstileSiteKey: string | null;
  } {
    return {
      googleClientId: this.auth.googleClientId(),
      turnstileSiteKey: this.auth.turnstileSiteKey(),
    };
  }

  /** Emails a 6-digit code; the account is created by `signup/verify`. */
  @Post('signup')
  @HttpCode(202)
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
  ): Promise<SignupStarted> {
    const ip = req.ip ?? 'unknown';
    await this.auth.verifyHuman(dto.turnstileToken, ip);
    return this.auth.signup(dto, ip);
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
  resendSignup(
    @Body() dto: ResendSignupDto,
    @Req() req: Request,
  ): Promise<SignupStarted> {
    return this.auth.resendSignupCode(dto, req.ip ?? 'unknown');
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

  /** Emails a 6-digit code to an existing account; answers the same for an unknown email. */
  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<SignupStarted> {
    const ip = req.ip ?? 'unknown';
    await this.auth.verifyHuman(dto.turnstileToken, ip);
    return this.auth.forgotPassword(dto, ip);
  }

  /** The emailed code + a new password → saved, and signed in. */
  @Post('password/reset')
  @HttpCode(200)
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<AuthResult> {
    return this.auth.resetPassword(dto, req.ip ?? 'unknown');
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

  /** Returns a fresh token: every OTHER device is signed out by the change. */
  @Post('me/password')
  @UseGuards(CustomerJwtGuard)
  @HttpCode(200)
  changePassword(
    @Req() req: AuthedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResult> {
    return this.auth.changePassword(
      req.user.customerId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  /** For an account with no password yet (created through Google): emails a code to set one. */
  @Post('me/password/code')
  @UseGuards(CustomerJwtGuard)
  @HttpCode(202)
  sendPasswordCode(@Req() req: AuthedRequest): Promise<SignupStarted> {
    return this.auth.sendPasswordCode(req.user.customerId, req.ip ?? 'unknown');
  }

  /** step12c: an account opened by phone adds an email — a code is emailed to it first. */
  @Post('me/email/code')
  @UseGuards(CustomerJwtGuard)
  @HttpCode(202)
  sendEmailCode(
    @Req() req: AuthedRequest,
    @Body() dto: EmailCodeDto,
  ): Promise<SignupStarted> {
    return this.auth.sendEmailCode(
      req.user.customerId,
      dto.email,
      req.ip ?? 'unknown',
    );
  }

  @Post('me/email')
  @UseGuards(CustomerJwtGuard)
  @HttpCode(200)
  verifyEmail(
    @Req() req: AuthedRequest,
    @Body() dto: EmailVerifyDto,
  ): Promise<PublicCustomer> {
    return this.auth.verifyEmail(
      req.user.customerId,
      dto.email,
      dto.code,
      req.ip ?? 'unknown',
    );
  }
}
