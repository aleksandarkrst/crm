import { Controller, Get, Query } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { departments, employees, teams } from '../../shared/database/schema';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { PeopleAccess } from './people-access';
import { PeopleHistoryQuery, PeopleHistoryService } from './people-history.service';

/**
 * The rest of the people API for every member: the caller's own access, the history of employees,
 * departments and teams (with the card's rules), and the departments and teams to show and pick.
 * Changing departments and teams is CD-138.
 */
@Controller('people')
@RequireTenant('member')
export class PeopleController {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly history: PeopleHistoryService,
  ) {}

  /** The caller's functional roles, own employee id and report ids: `{ employeeId, roles, directReportIds, reportIds }`. */
  @Get('access')
  async me(@Tenant() ctx: TenantContext) {
    return (await this.access.of(ctx)).toJSON();
  }

  /** `?entityType=employee|department|team&entityId=…&limit=50&offset=0`, newest first: `{ entries, more }`. */
  @Get('history')
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(PeopleHistoryQuery)) query: PeopleHistoryQuery) {
    return this.history.list(ctx, query);
  }

  /** Every department, by name, with its head and number of active employees. */
  @Get('departments')
  departments(@Tenant() ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({
          id: departments.id,
          name: departments.name,
          code: departments.code,
          headEmployeeId: departments.headEmployeeId,
          version: departments.updatedAt,
          activeEmployees: sql<number>`(select count(*)::int from ${employees} e where e.department_id = ${departments.id} and e.deactivated_at is null)`,
        })
        .from(departments)
        .orderBy(asc(sql`lower(${departments.name})`)),
    );
  }

  /** Every team, by department and name, with its lead and number of active employees. */
  @Get('teams')
  teams(@Tenant() ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({
          id: teams.id,
          departmentId: teams.departmentId,
          name: teams.name,
          leadEmployeeId: teams.leadEmployeeId,
          version: teams.updatedAt,
          activeEmployees: sql<number>`(select count(*)::int from ${employees} e where e.team_id = ${teams.id} and e.deactivated_at is null)`,
        })
        .from(teams)
        .innerJoin(departments, eq(departments.id, teams.departmentId))
        .orderBy(asc(sql`lower(${departments.name})`), asc(sql`lower(${teams.name})`)),
    );
  }
}
