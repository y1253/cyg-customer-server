import { Global, Module } from '@nestjs/common';
import { CommUsageService } from './comm-usage.service';

/** step12d: text / call cost tracking — global, so every sender reaches it. */
@Global()
@Module({
  providers: [CommUsageService],
  exports: [CommUsageService],
})
export class CommUsageModule {}
