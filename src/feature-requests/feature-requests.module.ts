import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { FeatureRequestsController } from './feature-requests.controller';
import { FeatureRequestsService } from './feature-requests.service';

/**
 * step12e: what customers asked the AI for that the app does not do yet. The rows are
 * written by the assistant's `request_feature` tool (`feature-requests.store.ts`); staff
 * mark them in the internal app; this module lists them and sends the DONE message.
 */
@Module({
  imports: [CustomerAuthModule, MessagingModule, SchedulesModule],
  controllers: [FeatureRequestsController],
  providers: [FeatureRequestsService],
})
export class FeatureRequestsModule {}
