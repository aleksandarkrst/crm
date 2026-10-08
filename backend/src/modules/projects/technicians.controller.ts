import { Controller, Get } from '@nestjs/common';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, orgUnits } from '../../shared/database/schema';

/**
 * Settings → Technicians (CD-268, design v2 §8): everyone who hasn't left, with their team, work
 * type and open work: active assignments on tasks that aren't Done in open projects, and work
 * orders they're on that aren't Completed. Owners and admins; the work type is changed through the employee
 * (`PATCH /api/people/employees/:id { workType }`), the same field as on the Workforce card.
 */
@Controller('technicians')
@RequireTenant('admin')
export class TechniciansController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  list(@Tenant() ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({
          employeeId: employees.id,
          name: employees.fullName,
          jobTitle: employees.jobTitle,
          team: orgUnits.name,
          workType: employees.workType,
          openTasks: sql<number>`(select count(*)::int from task_assignments a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
            where a.employee_id = "employees"."id" and a.active and t.status <> 'done' and p.status = 'open')`,
          openWorkOrders: sql<number>`(select count(*)::int from work_order_technicians wt join work_orders w on w.id = wt.work_order_id
            where wt.employee_id = "employees"."id" and w.status <> 'completed')`,
        })
        .from(employees)
        .leftJoin(orgUnits, eq(orgUnits.id, employees.unitId))
        .where(isNull(employees.deactivatedAt))
        .orderBy(asc(employees.fullName)),
    );
  }
}
