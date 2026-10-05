import { Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ASSIGNED_ROLES, type AssignedRole } from '../../shared/database/schema';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { permissionMatrix } from './permissions';
import { RolesService } from './roles.service';

const RoleParam = z.enum(ASSIGNED_ROLES, { message: 'Only Administration and Payroll are assigned. Admin comes from the workspace role, Manager from reporting lines.' });

/**
 * Functional roles (CD-142, spec 9): the permission matrix every screen shows, who has which role,
 * and assigning Administration and Payroll (Admins only; RolesService checks).
 */
@Controller('people')
@RequireTenant('member')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** The permission matrix (spec 9.3) the server checks against: `{ roles, modules: [{ id, name, milestone, live, rows }] }`. */
  @Get('permissions')
  permissions() {
    return permissionMatrix();
  }

  /** "Who has which role": `{ administration, payroll, admins, managers }`. */
  @Get('roles')
  holders(@Tenant() ctx: TenantContext) {
    return this.roles.holders(ctx);
  }

  /** Admin: gives the employee Administration or Payroll. `{ employeeId, roles }`. */
  @Put('employees/:id/roles/:role')
  grant(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Param('role', new ZodPipe(RoleParam)) role: AssignedRole) {
    return this.roles.grant(ctx, id, role);
  }

  /** Admin: takes Administration or Payroll away. */
  @Delete('employees/:id/roles/:role')
  @HttpCode(204)
  async remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Param('role', new ZodPipe(RoleParam)) role: AssignedRole) {
    await this.roles.remove(ctx, id, role);
  }
}
