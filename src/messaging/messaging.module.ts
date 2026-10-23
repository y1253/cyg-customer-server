import { Module } from '@nestjs/common';
import { OpenAiClient } from '../ai/openai.client';
import { CommPricesService } from '../comm-usage/comm-prices.service';
import { CustomerMessenger } from './customer-messenger.service';
import { SignalWireClient } from './signalwire.client';

/**
 * step11b: texting / WhatsApping customers from the customer API itself. step12d: also the
 * text / call price upkeep (`CommPricesService` — it needs SignalWire and the AI).
 */
@Module({
  providers: [
    CustomerMessenger,
    SignalWireClient,
    OpenAiClient,
    CommPricesService,
  ],
  exports: [CustomerMessenger, SignalWireClient],
})
export class MessagingModule {}
