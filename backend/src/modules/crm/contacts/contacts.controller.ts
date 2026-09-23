import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { ContactsQuery, ContactsService, CreateContact, UpdateContact } from './contacts.service';

@Controller('crm/contacts')
@RequireTenant('member')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ContactsQuery)) query: ContactsQuery) {
    return this.contacts.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.contacts.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateContact)) body: CreateContact) {
    return this.contacts.create(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateContact)) body: UpdateContact) {
    return this.contacts.update(ctx, id, body);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.contacts.remove(ctx, id);
  }
}
