import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { CreateProduct, ProductsQuery, ProductsService, UpdateProduct } from './products.service';

@Controller('crm/products')
@RequireTenant('member')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ProductsQuery)) query: ProductsQuery) {
    return this.products.list(ctx, query);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateProduct)) body: CreateProduct) {
    return this.products.create(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateProduct)) body: UpdateProduct) {
    return this.products.update(ctx, id, body);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.products.remove(ctx, id);
  }
}
