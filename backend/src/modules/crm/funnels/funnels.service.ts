import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { CHANNELS, funnels, funnelStages } from '../../../shared/database/schema';
import { type TenantProvisioner, TenantProvisioning } from '../../../shared/events/tenant-provisioning';
import { nonEmptyPatch } from '../../../shared/validation/common';
import { DEFAULT_FUNNELS } from './default-funnels';

export const UpdateStage = nonEmptyPatch(
  z.object({
    name: z.string().trim().min(1).max(100).optional(),
    activity: z.string().trim().min(1).max(200).optional(),
    channel: z.enum(CHANNELS).optional(),
    documentOnEntry: z.string().trim().max(60).nullish(),
    winProbability: z.number().int().min(0).max(100).optional(),
    checklist: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  }),
);
export type UpdateStage = z.infer<typeof UpdateStage>;

/** Funnels are the per-persona playbooks: ordered stages with activity, channel and to-dos. */
@Injectable()
export class FunnelsService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  /** Seeds the default funnels for a brand-new tenant (runs inside tenant creation). */
  async provision(tx: Tx, tenantId: string): Promise<void> {
    for (const [position, template] of DEFAULT_FUNNELS.entries()) {
      const [funnel] = await tx
        .insert(funnels)
        .values({ tenantId, key: template.key, label: template.label, note: template.note, position })
        .returning({ id: funnels.id });
      await tx.insert(funnelStages).values(
        template.stages.map((s, i) => ({ ...s, tenantId, funnelId: funnel!.id, position: i, isWon: s.key === 'won' })),
      );
    }
  }

  /** All funnels with their stages in order. */
  list(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const fs = await tx.select().from(funnels).orderBy(asc(funnels.position));
      if (fs.length === 0) return [];
      const stages = await tx
        .select()
        .from(funnelStages)
        .where(inArray(funnelStages.funnelId, fs.map((f) => f.id)))
        .orderBy(asc(funnelStages.position));
      return fs.map((f) => ({ ...f, stages: stages.filter((s) => s.funnelId === f.id) }));
    });
  }

  updateStage(ctx: TenantContext, funnelId: string, stageId: string, input: UpdateStage) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .update(funnelStages)
          .set(input)
          .where(and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, funnelId)))
          .returning();
        if (!row) throw new NotFoundException('Stage not found');
        await this.audit.record(tx, ctx, { action: 'funnel.stage_updated', entityType: 'funnel_stage', entityId: stageId, data: input });
        return row;
      })
      .catch(mapDbError);
  }
}
