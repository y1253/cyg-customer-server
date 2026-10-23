import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import {
  FeatureRequestsService,
  type FeatureRequestView,
} from './feature-requests.service';

type AuthedRequest = Request & { user: CustomerRequestUser };

/** step12e: `/api/feature-requests` — the customer's "My requests" page (read-only). */
@Controller('feature-requests')
@UseGuards(CustomerJwtGuard)
export class FeatureRequestsController {
  constructor(private readonly requests: FeatureRequestsService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<FeatureRequestView[]> {
    return this.requests.listForCustomer(req.user.customerId);
  }
}
