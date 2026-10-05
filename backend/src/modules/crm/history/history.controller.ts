import { Controller, Get, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { HistoryQuery, RecordHistoryService } from './record-history.service';

/** Change history of one deal, company, contact or meeting (CD-69, CD-130); every member can read it. */
@Controller('crm/history')
@RequireTenant('member')
export class HistoryController {
  constructor(private readonly history: RecordHistoryService) {}

  /** `?entityType=deal|company|contact|meeting&entityId=…&limit=50&offset=0`, newest first: `{ entries, more }`. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(HistoryQuery)) query: HistoryQuery) {
    return this.history.list(ctx, query);
  }
}
