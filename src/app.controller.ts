import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** `GET /api/health` — unauthenticated liveness check for deploys. */
  @Get('health')
  health(): { status: 'ok' } {
    return this.appService.health();
  }
}
