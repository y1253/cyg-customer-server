import { Global, Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';

/** step12: AI cost tracking — global, so every module's `OpenAiClient` reaches it. */
@Global()
@Module({
  providers: [AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
