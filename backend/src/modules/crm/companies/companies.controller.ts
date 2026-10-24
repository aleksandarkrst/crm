import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { CompaniesQuery, CompaniesService, CreateCompany, SetCompanyStatus, UpdateCompany } from './companies.service';
import { CompanyStatusService } from './company-status.service';

@Controller('crm/companies')
@RequireTenant('member')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly status: CompanyStatusService,
  ) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(CompaniesQuery)) page: CompaniesQuery) {
    return this.companies.list(ctx, page);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.companies.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateCompany)) body: CreateCompany) {
    return this.companies.create(ctx, body);
  }

  /** `If-Match: <updatedAt>` makes the update fail with 409 if someone changed these fields since (CD-20). */
  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', new ZodPipe(UuidParam)) id: string,
    @Body(new ZodPipe(UpdateCompany)) body: UpdateCompany,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.companies.update(ctx, id, body, parseVersion(ifMatch));
  }

  /** "Set status back…" or "Back to automatic" (CD-358): owners, admins and the company's owner. */
  @Patch(':id/status')
  setStatus(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(SetCompanyStatus)) body: SetCompanyStatus) {
    return this.status.setStatus(ctx, id, body.status);
  }

  /** The company's status changes, newest first, with who and why (CD-358). */
  @Get(':id/status-history')
  statusHistory(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.status.history(ctx, id);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.companies.remove(ctx, id);
  }
}
