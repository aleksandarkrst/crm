import { Controller, Get } from '@nestjs/common';
import { RequireTenant } from '../../shared/authorization';
import { permissionMatrix } from './permissions';

/**
 * Functional roles (CD-142, spec 9): the permission matrix every screen shows. Roles are derived
 * (Employee, Manager from reporting lines, Admin from the workspace role); assigning Administration
 * and Payroll, and the "Who has which role" list, were removed by CD-225.
 */
@Controller('people')
@RequireTenant('member')
export class RolesController {
  /** The permission matrix (spec 9.3) the server checks against: `{ roles, modules: [{ id, name, milestone, live, rows }] }`. */
  @Get('permissions')
  permissions() {
    return permissionMatrix();
  }
}
