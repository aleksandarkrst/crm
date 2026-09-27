import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { ListQuery, UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { CompaniesService, CreateCompany, UpdateCompany } from './companies.service';

@Controller('crm/companies')
@RequireTenant('member')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ListQuery)) page: ListQuery) {
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

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.companies.remove(ctx, id);
  }
}
