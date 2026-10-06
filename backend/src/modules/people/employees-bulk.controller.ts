import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { BulkUpdateEmployees, EmployeesBulkService, ExportEmployees } from './employees-bulk.service';

/**
 * The Org structure list's bulk actions and personal-details export (CD-137, spec 5.4).
 * Admins; the service checks it per caller and per row.
 */
@Controller('people/employees')
@RequireTenant('member')
export class EmployeesBulkController {
  constructor(private readonly bulk: EmployeesBulkService) {}

  /** "Set unit" / "Set manager" for the ticked rows and the chart's drag: `{ updated }`. All or nothing. */
  @Post('bulk')
  @HttpCode(200)
  update(@Tenant() ctx: TenantContext, @Body(new ZodPipe(BulkUpdateEmployees)) body: BulkUpdateEmployees) {
    return this.bulk.update(ctx, body);
  }

  /** Export with "Include personal details and bank accounts": `{ employees: [{ id, personal, bank }] }`. Audited. */
  @Post('export')
  @HttpCode(200)
  exportPersonal(@Tenant() ctx: TenantContext, @Body(new ZodPipe(ExportEmployees)) body: ExportEmployees) {
    return this.bulk.exportPersonal(ctx, body);
  }
}
