import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { parseVersion } from '../../shared/validation/version';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { ApproversQuery, CreateEmployee, EmployeeListQuery, RevealBankAccount, UpdateEmployeeBody } from './employees.schemas';
import { EmployeesService } from './employees.service';

/**
 * Employees (milestone 13, spec 4). Every member may call these; what each caller sees and may
 * change is decided per field by PeopleAccess (spec 9). See docs/ARCHITECTURE.md, "People".
 */
@Controller('people/employees')
@RequireTenant('member')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /** The directory: `{ employees, total }`, filters per EmployeeListQuery. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(EmployeeListQuery)) query: EmployeeListQuery) {
    return this.employees.list(ctx, query);
  }

  /** The card: sections the caller may not see are absent. */
  @Get(':id')
  card(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.employees.card(ctx, id);
  }

  /** "Approvals go to" for `?date=yyyy-mm-dd` (default today). */
  @Get(':id/approvers')
  approvers(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Query(new ZodPipe(ApproversQuery)) query: ApproversQuery) {
    return this.employees.approvers(ctx, id, query.date);
  }

  /** Admins. Returns the card. */
  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateEmployee)) body: CreateEmployee) {
    return this.employees.create(ctx, body);
  }

  /**
   * `If-Match: <version>` (the card's `version`): a field someone else changed since is a 409.
   * Moving a head or lead elsewhere needs `clearHeadRoles: true` (409 `heads_department` otherwise).
   * Returns the card.
   */
  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', new ZodPipe(UuidParam)) id: string,
    @Body(new ZodPipe(UpdateEmployeeBody)) body: UpdateEmployeeBody,
    @Headers('if-match') ifMatch?: string,
  ) {
    const { clearHeadRoles, ...fields } = body;
    return this.employees.update(ctx, id, fields, parseVersion(ifMatch), !!clearHeadRoles);
  }

  /** The full IBAN ("Show", "Copy"): self, Admin. Audited as "IBAN viewed". */
  @Post(':id/bank/reveal')
  @HttpCode(200)
  reveal(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(RevealBankAccount)) body: RevealBankAccount) {
    return this.employees.reveal(ctx, id, body.account);
  }

  /** Admin; only an employee who was deactivated first (409 otherwise). */
  @Delete(':id')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.employees.remove(ctx, id);
  }
}
