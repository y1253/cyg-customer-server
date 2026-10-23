import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MessagingModule } from '../messaging/messaging.module';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerJwtGuard } from './customer-jwt.guard';
import { CustomerJwtStrategy } from './customer-jwt.strategy';
import { IntakeSystemGuard } from './intake-system.guard';
import {
  IntakeSignupController,
  PhoneLoginController,
} from './phone-auth.controller';
import { PhoneAuthService } from './phone-auth.service';

@Module({
  imports: [
    PassportModule,
    MessagingModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // ⚠️ NOT `JWT_SECRET` — that is the internal app's staff secret.
        secret: config.getOrThrow<string>('CUSTOMER_JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    CustomerAuthController,
    PhoneLoginController,
    IntakeSignupController,
  ],
  providers: [
    CustomerAuthService,
    CustomerJwtStrategy,
    CustomerJwtGuard,
    PhoneAuthService,
    IntakeSystemGuard,
  ],
  exports: [CustomerJwtGuard, CustomerAuthService, IntakeSystemGuard],
})
export class CustomerAuthModule {}
