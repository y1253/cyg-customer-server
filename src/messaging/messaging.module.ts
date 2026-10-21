import { Module } from '@nestjs/common';
import { CustomerMessenger } from './customer-messenger.service';
import { SignalWireClient } from './signalwire.client';

/** step11b: texting / WhatsApping customers from the customer API itself. */
@Module({
  providers: [CustomerMessenger, SignalWireClient],
  exports: [CustomerMessenger, SignalWireClient],
})
export class MessagingModule {}
