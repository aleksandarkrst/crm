import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { timeEntries, timesheetDays } from '../../shared/database/schema';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';

const StandInHours = z.object({
  employeeId: z.uuid(),
  hours: z
    .number()
    .min(0.25)
    .max(24)
    .refine((h) => Number.isInteger(h * 4), 'Use steps of 0.25'),
  approved: z.boolean().default(false),
});
type StandInHours = z.infer<typeof StandInHours>;

/**
 * Development only (AUTH_MODE=dev): logs hours on a task for browser tests (the People and hours
 * card, CD-147), as a time entry on a day of its own in January 2026 (CD-152), whatever the rules
 * for who may log time; `approved` approves that day. The lock still applies.
 */
@Controller('dev/tasks')
export class DevTasksController {
  constructor(private readonly database: DatabaseService) {}

  @Post(':id/hours')
  @RequireTenant('member')
  @HttpCode(204)
  async logHours(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) taskId: string, @Body(new ZodPipe(StandInHours)) body: StandInHours) {
    await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const { rows } = await tx.execute<{ day: string }>(
          sql`select (coalesce(max(work_date) + 1, date '2026-01-05'))::text as day from time_entries where employee_id = ${body.employeeId} and work_date < date '2026-02-01'`,
        );
        const workDate = rows[0]!.day;
        await tx.insert(timeEntries).values({ tenantId: ctx.tenantId, taskId, employeeId: body.employeeId, workDate, minutes: Math.round(body.hours * 60), createdByUserId: ctx.userId });
        if (body.approved) await tx.insert(timesheetDays).values({ tenantId: ctx.tenantId, employeeId: body.employeeId, workDate, status: 'approved' });
      })
      .catch(mapDbError);
  }
}

@Module({ controllers: [DevTasksController] })
export class ProjectsDevModule {}
