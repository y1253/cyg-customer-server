import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { type AuthResult, CustomerAuthService } from './customer-auth.service';
import {
  PhoneLoginDto,
  PhoneLoginVerifyDto,
  PhoneSignupDto,
} from './dto/phone-login.dto';
import { IntakeSystemGuard } from './intake-system.guard';
import {
  PhoneAuthService,
  type PhoneCodeSent,
  type PhoneSignupResult,
} from './phone-auth.service';

/** step12c: `/api/customer-auth/login/phone*` — sign in with a code texted to your phone. */
@Controller('customer-auth/login/phone')
export class PhoneLoginController {
  constructor(
    private readonly phone: PhoneAuthService,
    private readonly auth: CustomerAuthService,
  ) {}

  /** Texts a 6-digit code; answers the same for a number with no account. */
  @Post()
  @HttpCode(202)
  async request(
    @Body() dto: PhoneLoginDto,
    @Req() req: Request,
  ): Promise<PhoneCodeSent> {
    const ip = req.ip ?? 'unknown';
    await this.auth.verifyHuman(dto.turnstileToken, ip);
    return this.phone.requestCode(dto.phone, ip);
  }

  @Post('verify')
  @HttpCode(200)
  verify(
    @Body() dto: PhoneLoginVerifyDto,
    @Req() req: Request,
  ): Promise<AuthResult> {
    return this.phone.verifyCode(dto.phone, dto.code, req.ip ?? 'unknown');
  }
}

/**
 * step12c: `/api/intake-system/signup` — called by the INTERNAL API only, when a phone with
 * no account replied YES to the texted sign-up offer (`IntakeSystemGuard`).
 */
@Controller('intake-system')
@UseGuards(IntakeSystemGuard)
export class IntakeSignupController {
  constructor(private readonly phone: PhoneAuthService) {}

  @Post('signup')
  @HttpCode(200)
  signup(@Body() dto: PhoneSignupDto): Promise<PhoneSignupResult> {
    return this.phone.signupByPhone(dto.phone, dto.createdWith);
  }
}
