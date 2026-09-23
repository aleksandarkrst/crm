import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../authorization';
import type { Tx } from '../database/database.service';
import { auditLogs } from '../database/schema';

export interface AuditEntry {
  action: string; // e.g. "deal.stage_changed"
  entityType: string; // e.g. "deal"
  entityId?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  /** Writes inside the caller's transaction, so the audit row commits or rolls back with the change. */
  async record(tx: Tx, ctx: TenantContext, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      data: entry.data,
    });
  }
}
