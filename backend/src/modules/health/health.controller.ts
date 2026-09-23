import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /** Liveness: the process is up. Used by the Docker healthcheck. */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: the database is reachable. Used by the deploy script after rollout. */
  @Get('ready')
  async ready() {
    try {
      await this.database.ping();
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
  }
}
