import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service.js';
import { BypassIpAllowlist, Public } from '../../common/auth/decorators.js';

@Controller('health')
@BypassIpAllowlist()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Public()
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return this.health.checkLive();
  }

  @Get('ready')
  @Public()
  @HttpCode(HttpStatus.OK)
  async ready() {
    const result = await this.health.checkReady();
    return result;
  }
}
