import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { CreateCustomField, CustomFieldsQuery, CustomFieldsService, ReorderCustomFields, UpdateCustomField } from './custom-fields.service';

/** Custom field definitions (CD-15). Everyone reads them; owners and admins change them. */
@Controller('crm/custom-fields')
@RequireTenant('admin')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @RequireTenant('member')
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(CustomFieldsQuery)) query: CustomFieldsQuery) {
    return this.fields.list(ctx, query);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateCustomField)) body: CreateCustomField) {
    return this.fields.create(ctx, body);
  }

  @Put('order')
  reorder(@Tenant() ctx: TenantContext, @Body(new ZodPipe(ReorderCustomFields)) body: ReorderCustomFields) {
    return this.fields.reorder(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateCustomField)) body: UpdateCustomField) {
    return this.fields.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.fields.remove(ctx, id);
  }
}
