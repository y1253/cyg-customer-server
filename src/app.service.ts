import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
