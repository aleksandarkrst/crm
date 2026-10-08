import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { taskTimeFixtures } from '../../shared/database/schema';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';

const StandInHours = z.object({ employeeId: z.uuid(), hours: z.number().positive().max(9999), approved: z.boolean().default(false) });
type StandInHours = z.infer<typeof StandInHours>;

/**
 * Development only (AUTH_MODE=dev): logs stand-in hours on a task (`task_time_fixtures`, CD-147) so
 * browser tests can show the People and hours card with hours before milestone 15's time entries.
 * Goes away with that table.
 */
@Controller('dev/tasks')
export class DevTasksController {
  constructor(private readonly database: DatabaseService) {}

  @Post(':id/hours')
  @RequireTenant('member')
  @HttpCode(204)
  async logHours(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) taskId: string, @Body(new ZodPipe(StandInHours)) body: StandInHours) {
    await this.database.withTenant(ctx.tenantId, (tx) => tx.insert(taskTimeFixtures).values({ tenantId: ctx.tenantId, taskId, ...body }));
  }
}

@Module({ controllers: [DevTasksController] })
export class ProjectsDevModule {}
