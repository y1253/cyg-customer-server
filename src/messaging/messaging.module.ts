import { Module } from '@nestjs/common';
import { CustomerMessenger } from './customer-messenger.service';

/** step11b: texting / WhatsApping customers from the customer API itself. */
@Module({
  providers: [CustomerMessenger],
  exports: [CustomerMessenger],
})
export class MessagingModule {}
