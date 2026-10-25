import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { ActivitiesService, CreateActivity } from './activities.service';
import { CreateDeal, DealsQuery, DealsService, MarkLost, MoveDeal, UpdateDeal } from './deals.service';
import { ProposalApprovalService } from './proposal-approval.service';

const Id = new ZodPipe(UuidParam);

@Controller('crm/deals')
@RequireTenant('member')
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly activities: ActivitiesService,
    private readonly approval: ProposalApprovalService,
  ) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(DealsQuery)) query: DealsQuery) {
    return this.deals.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.deals.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateDeal)) body: CreateDeal) {
    return this.deals.create(ctx, body);
  }

  /** `If-Match: <updatedAt>` makes the update fail with 409 if someone changed these fields since (CD-20). */
  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateDeal)) body: UpdateDeal, @Headers('if-match') ifMatch?: string) {
    return this.deals.update(ctx, id, body, parseVersion(ifMatch));
  }

  /** Pipeline drag & drop and "Advance to <stage>". */
  @Post(':id/move')
  @HttpCode(200)
  move(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(MoveDeal)) body: MoveDeal) {
    return this.deals.moveToStage(ctx, id, body.stageId);
  }

  /** "Mark as lost" on the deal screen: a reason from the pick list and an optional note. */
  @Post(':id/lost')
  @HttpCode(200)
  markLost(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(MarkLost)) body: MarkLost) {
    return this.deals.markLost(ctx, id, body);
  }

  /** "Remind the owner" (CD-363): emails the stage owner, else the opportunity's owner. */
  @Post(':id/remind-stage-owner')
  @HttpCode(202)
  remindStageOwner(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.deals.remindStageOwner(ctx, id);
  }

  // Proposal approval (CD-120): each answers with the opportunity's approval as it now stands.
  @Post(':id/approval/request')
  @HttpCode(200)
  requestApproval(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.approval.request(ctx, id);
  }

  /** The funnel's approver, owners and admins (403 for anyone else). */
  @Post(':id/approval/approve')
  @HttpCode(200)
  approve(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.approval.approve(ctx, id);
  }

  @Post(':id/approval/revoke')
  @HttpCode(200)
  revokeApproval(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.approval.revoke(ctx, id);
  }

  /** "Mark as sent": a 409 while the funnel's approval is missing. */
  @Post(':id/proposal/sent')
  @HttpCode(200)
  markProposalSent(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.approval.markSent(ctx, id);
  }

  /** "Reopen" on a lost deal: back to open, in the stage it was lost in. */
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.deals.reopen(ctx, id);
  }

  @Put(':id/contacts/:contactId')
  @HttpCode(204)
  linkContact(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('contactId', Id) contactId: string) {
    return this.deals.linkContact(ctx, id, contactId);
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  unlinkContact(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('contactId', Id) contactId: string) {
    return this.deals.unlinkContact(ctx, id, contactId);
  }

  @Get(':id/activities')
  listActivities(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.activities.list(ctx, id);
  }

  /** Composer "Send & log", "Save note", "Log call", completed to-dos. */
  @Post(':id/activities')
  logActivity(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(CreateActivity)) body: CreateActivity) {
    return this.activities.create(ctx, id, body);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.deals.remove(ctx, id);
  }
}
