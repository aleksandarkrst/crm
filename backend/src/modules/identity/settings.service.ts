import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { AuthUser, TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { funnels, memberships, tenants, users } from '../../shared/database/schema';
import { IdentityService } from './identity.service';
import type { UpdateProfile, UpdateWorkspace } from './settings.schemas';

const workspaceColumns = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  currency: tenants.currency,
  timezone: tenants.timezone,
  fiscalYearStartMonth: tenants.fiscalYearStartMonth,
};

/**
 * Workspace settings (a row of `tenants`) and the signed-in user's profile (their `users` row plus
 * their membership of the current workspace). Both tables are platform tables without RLS, so
 * every query filters by the caller's tenant and user id explicitly; nothing here takes an id
 * from the request.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  async getWorkspace(ctx: TenantContext) {
    const [row] = await this.database.db.select(workspaceColumns).from(tenants).where(eq(tenants.id, ctx.tenantId));
    if (!row) throw new NotFoundException('Workspace not found');
    return row;
  }

  /** Owners and admins only (enforced by the route). */
  updateWorkspace(ctx: TenantContext, input: UpdateWorkspace) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.update(tenants).set(input).where(eq(tenants.id, ctx.tenantId)).returning(workspaceColumns);
      if (!row) throw new NotFoundException('Workspace not found');
      await this.audit.record(tx, ctx, { action: 'workspace.updated', entityType: 'tenant', entityId: ctx.tenantId, data: input });
      return row;
    });
  }

  async getProfile(ctx: TenantContext) {
    const [row] = await this.database.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        jobTitle: users.jobTitle,
        phone: users.phone,
        language: users.language,
        dateFormat: users.dateFormat,
        startPage: users.startPage,
        defaultFunnelId: memberships.defaultFunnelId,
        dailyDigest: memberships.dailyDigest,
      })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, ctx.tenantId)))
      .where(eq(users.id, ctx.userId));
    if (!row) throw new NotFoundException('Profile not found');
    return row;
  }

  /** Updates the caller's own profile; `defaultFunnelId` and `dailyDigest` apply to this workspace only. */
  async updateProfile(ctx: TenantContext, user: AuthUser, input: UpdateProfile) {
    const { defaultFunnelId, dailyDigest, ...own } = input;
    await this.database.withTenant(ctx.tenantId, async (tx) => {
      if (defaultFunnelId) {
        // RLS is on, so a funnel of another workspace is simply not found.
        const [funnel] = await tx.select({ id: funnels.id }).from(funnels).where(eq(funnels.id, defaultFunnelId));
        if (!funnel) throw new BadRequestException('defaultFunnelId is not a funnel of this workspace');
      }
      if (Object.keys(own).length) {
        await tx
          .update(users)
          .set({ ...own, ...(own.displayName !== undefined ? { displayNameCustom: true } : {}) })
          .where(eq(users.id, ctx.userId));
      }
      if (defaultFunnelId !== undefined || dailyDigest !== undefined) {
        await tx
          .update(memberships)
          .set({ defaultFunnelId, dailyDigest })
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId)));
      }
    });
    // The cached user (name) must not outlive the change.
    this.identity.forgetUser(user.authSubject);
    return this.getProfile(ctx);
  }
}
