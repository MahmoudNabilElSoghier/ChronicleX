import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Liveness — no dependency checks.
  @Get('health')
  @HttpCode(200)
  liveness(): { status: 'ok'; version: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      version: process.env.APP_VERSION ?? '0.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  // Readiness — pings PG + Redis + MinIO. 503 if any dep is down.
  @Get('ready')
  @HttpCode(200)
  async readiness(): Promise<{
    status: 'ok' | 'degraded';
    checks: Record<'postgres' | 'redis' | 'minio', 'up' | 'down'>;
  }> {
    const checks = await this.health.checkDependencies();
    const allUp = Object.values(checks).every((s) => s === 'up');
    if (!allUp) {
      throw new ServiceUnavailableException({ status: 'degraded', checks });
    }
    return { status: 'ok', checks };
  }
}
