import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { MeetingMinutesService, SaveInternalMinutes } from './meeting-minutes.service';

const Id = new ZodPipe(UuidParam);

/**
 * The internal minutes of a meeting (CD-132). Every member reads them; writing them takes the
 * meeting's organizer, an internal participant, an admin or the owner (403), on a meeting that
 * isn't cancelled (409).
 */
@Controller('crm/meetings')
@RequireTenant('member')
export class MeetingMinutesController {
  constructor(private readonly minutes: MeetingMinutesService) {}

  @Get(':id/minutes/internal')
  getInternal(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.minutes.getInternal(ctx, id);
  }

  /** Partial: the fields sent replace the stored ones. `If-Match: <updatedAt>` (or the epoch before the first save) catches conflicting edits. */
  @Put(':id/minutes/internal')
  saveInternal(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(SaveInternalMinutes)) body: SaveInternalMinutes, @Headers('if-match') ifMatch?: string) {
    return this.minutes.saveInternal(ctx, id, body, parseVersion(ifMatch));
  }

  /** Makes a deal task of a next step: `{ minutes, task }`. */
  @Post(':id/minutes/next-steps/:stepId/task')
  @HttpCode(201)
  createTask(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('stepId', Id) stepId: string) {
    return this.minutes.createTask(ctx, id, stepId);
  }
}
