import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return this.health.checkLive();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const result = await this.health.checkReady();
    return result;
  }
}
