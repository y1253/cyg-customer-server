import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Apply to any route that needs a signed-in customer. */
@Injectable()
export class CustomerJwtGuard extends AuthGuard('customer-jwt') {}
