import { Controller, Get, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { PeopleAccess } from './people-access';
import { PeopleHistoryQuery, PeopleHistoryService } from './people-history.service';

/**
 * The rest of the people API for every member: the caller's own access and the history of
 * employees, departments and teams (with the card's rules). Departments, teams and reporting lines
 * are OrgController (CD-138, CD-139).
 */
@Controller('people')
@RequireTenant('member')
export class PeopleController {
  constructor(
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
}
