import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { AiContactsController } from './ai-contacts.controller';
import { AiContactsService } from './ai-contacts.service';

/** step12c: the AI's contacts (`AiContact`) and the Contacts tab. */
@Module({
  imports: [CustomerAuthModule],
  controllers: [AiContactsController],
  providers: [AiContactsService],
  exports: [AiContactsService],
})
export class AiContactsModule {}
