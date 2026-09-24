import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { BONUS_TRIGGERS, salesBonusRules, salesBonusSettings } from '../../../shared/database/schema';
import { assertOwnerIsMember } from '../owner';

const amount = (max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'string' && v.trim() === '' ? 0 : Number(v)))
    .pipe(z.number().min(0).max(max))
    .transform((v) => v.toFixed(2));

export const UpdateBonusSettings = z.object({ trigger: z.enum(BONUS_TRIGGERS) });
/** One salesperson's rule: `rate` %, and the flat `fixed` amount on deals under `floor`. */
export const PutBonusRule = z.object({ rate: amount(100), floor: amount(999_999_999_999), fixed: amount(999_999_999_999) });
export type UpdateBonusSettings = z.infer<typeof UpdateBonusSettings>;
export type PutBonusRule = z.infer<typeof PutBonusRule>;

/**
 * Sales bonus rules (CD-17). Only owners and admins may see or change them (the controller
 * requires the admin role, so members get 403); the Overview computes the bonuses from them.
 * Amounts are in the workspace currency.
 */
@Injectable()
export class BonusRulesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.read(tx));
  }

  updateSettings(ctx: TenantContext, input: UpdateBonusSettings) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await tx
        .insert(salesBonusSettings)
        .values({ tenantId: ctx.tenantId, trigger: input.trigger })
        .onConflictDoUpdate({ target: salesBonusSettings.tenantId, set: { trigger: input.trigger } });
      await this.audit.record(tx, ctx, { action: 'bonus_settings.updated', entityType: 'bonus_settings', data: input });
      return this.read(tx);
    });
  }

  /** Sets a member's rule (400 for someone who isn't a member of the workspace). */
  putRule(ctx: TenantContext, userId: string, input: PutBonusRule) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, userId);
        const values = { ...input, updatedByUserId: ctx.userId };
        await tx
          .insert(salesBonusRules)
          .values({ tenantId: ctx.tenantId, userId, ...values })
          .onConflictDoUpdate({ target: [salesBonusRules.tenantId, salesBonusRules.userId], set: values });
        await this.audit.record(tx, ctx, { action: 'bonus_rule.updated', entityType: 'user', entityId: userId, data: input });
        return this.read(tx);
      })
      .catch(mapDbError);
  }

  removeRule(ctx: TenantContext, userId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(salesBonusRules).where(eq(salesBonusRules.userId, userId)).returning({ userId: salesBonusRules.userId });
      if (!row) throw new NotFoundException('No bonus rule for this person');
      await this.audit.record(tx, ctx, { action: 'bonus_rule.deleted', entityType: 'user', entityId: userId });
    });
  }

  private async read(tx: Tx) {
    const [settings] = await tx.select({ trigger: salesBonusSettings.trigger }).from(salesBonusSettings);
    const rules = await tx
      .select({ userId: salesBonusRules.userId, rate: salesBonusRules.rate, floor: salesBonusRules.floor, fixed: salesBonusRules.fixed, updatedAt: salesBonusRules.updatedAt })
      .from(salesBonusRules);
    return { trigger: settings?.trigger ?? BONUS_TRIGGERS[0], rules };
  }
}
