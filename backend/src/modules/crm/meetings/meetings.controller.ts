import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { CancelMeeting, CreateMeeting, MeetingsQuery, MeetingsService, UpdateMeeting } from './meetings.service';

const Id = new ZodPipe(UuidParam);

/**
 * Meetings (CD-130). Every member sees and creates meetings; changing one takes its organizer, an
 * internal participant, an admin or the owner (403 otherwise); deleting one takes an admin.
 */
@Controller('crm/meetings')
@RequireTenant('member')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  /** `?from=&to=` (overlapping), filters, `ids=` for live updates: `{ meetings, more }`. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(MeetingsQuery)) query: MeetingsQuery) {
    return this.meetings.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.meetings.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateMeeting)) body: CreateMeeting) {
    return this.meetings.create(ctx, body);
  }

  /** `If-Match: <updatedAt>` makes the update fail with 409 if someone changed these fields since (CD-20). */
  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateMeeting)) body: UpdateMeeting, @Headers('if-match') ifMatch?: string) {
    return this.meetings.update(ctx, id, body, parseVersion(ifMatch));
  }

  @Post(':id/held')
  @HttpCode(200)
  markHeld(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.meetings.markHeld(ctx, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(CancelMeeting)) body: CancelMeeting) {
    return this.meetings.cancel(ctx, id, body);
  }

  @Post(':id/undo-held')
  @HttpCode(200)
  undoHeld(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.meetings.undoHeld(ctx, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.meetings.restore(ctx, id);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.meetings.remove(ctx, id);
  }
}
