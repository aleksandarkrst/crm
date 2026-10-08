import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { AuthUser, TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { JobsService } from '../../shared/events/jobs.service';
import { employees, funnels, memberships, tenants, users } from '../../shared/database/schema';
import { applyCeoRule } from '../people';
import { IdentityService } from './identity.service';
import type { UpdateProfile, UpdateWorkspace, WorkspaceTerms } from './settings.schemas';

const workspaceColumns = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  currency: tenants.currency,
  timezone: tenants.timezone,
  fiscalYearStartMonth: tenants.fiscalYearStartMonth,
  customerEmailLanguage: tenants.customerEmailLanguage,
  employeeDefaultWeeklyHours: tenants.employeeDefaultWeeklyHours,
  employeeNumberRequired: tenants.employeeNumberRequired,
  employeeSelfEditBank: tenants.employeeSelfEditBank,
  ceoEmployeeId: tenants.ceoEmployeeId,
  autoCreateProjects: tenants.autoCreateProjects,
  modules: tenants.modules,
  projectTerm: tenants.projectTerm,
  projectTermPlural: tenants.projectTermPlural,
  taskTerm: tenants.taskTerm,
  taskTermPlural: tenants.taskTermPlural,
};
type TermColumns = { projectTerm: string; projectTermPlural: string; taskTerm: string; taskTermPlural: string };

/** The row as the API returns it: the four names as `terms` (CD-143). */
function present<T extends TermColumns>({ projectTerm, projectTermPlural, taskTerm, taskTermPlural, ...row }: T) {
  return { ...row, terms: { project: projectTerm, projects: projectTermPlural, task: taskTerm, tasks: taskTermPlural } satisfies WorkspaceTerms };
}

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
    private readonly jobs: JobsService,
  ) {}

  async getWorkspace(ctx: TenantContext) {
    const [row] = await this.database.db.select(workspaceColumns).from(tenants).where(eq(tenants.id, ctx.tenantId));
    if (!row) throw new NotFoundException('Workspace not found');
    return present(row);
  }

  /**
   * Owners and admins only (enforced by the route). The CEO must be an active employee of the
   * workspace. A new CEO reports to nobody and becomes the manager of the top units' leads who
   * reported to the previous CEO or to nobody (people's `applyCeoRule`, CD-226, CD-228).
   */
  updateWorkspace(ctx: TenantContext, input: UpdateWorkspace) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      if (input.ceoEmployeeId) {
        // RLS is on, so an employee of another workspace is simply not found.
        const [ceo] = await tx.select({ deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, input.ceoEmployeeId));
        if (!ceo) throw new BadRequestException('The CEO must be an employee of this workspace');
        if (ceo.deactivatedAt) throw new BadRequestException('The CEO must be an active employee');
      }
      const [before] = input.ceoEmployeeId || input.terms ? await tx.select(workspaceColumns).from(tenants).where(eq(tenants.id, ctx.tenantId)) : [];
      const { terms, ...rest } = input;
      const names = terms ? { projectTerm: terms.project, projectTermPlural: terms.projects, taskTerm: terms.task, taskTermPlural: terms.tasks } : {};
      const [row] = await tx
        .update(tenants)
        .set({ ...rest, ...names })
        .where(eq(tenants.id, ctx.tenantId))
        .returning(workspaceColumns);
      if (!row) throw new NotFoundException('Workspace not found');
      if (input.ceoEmployeeId) await applyCeoRule(tx, this.jobs, ctx.tenantId, ctx.userId, input.ceoEmployeeId, before?.ceoEmployeeId ?? null);
      // Renamed projects or tasks (CD-143): the audit keeps the old names too.
      const data = terms && before ? { ...input, previousTerms: present(before).terms } : input;
      await this.audit.record(tx, ctx, { action: 'workspace.updated', entityType: 'tenant', entityId: ctx.tenantId, data });
      // Open screens show the new names without a reload: `tenants` has no change trigger, so hint here.
      if (terms) {
        await tx.execute(sql`select pg_notify('crm_changes', json_build_object('t', ${ctx.tenantId}::text, 'type', 'workspace', 'op', 'update', 'ids', json_build_array(${ctx.tenantId}::text), 'client', app_current_client())::text)`);
      }
      return present(row);
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
        notifyDealAssigned: memberships.notifyDealAssigned,
        notifyMeetingInvites: memberships.notifyMeetingInvites,
        notifyVisitPlans: memberships.notifyVisitPlans,
        notifyOrgChanges: memberships.notifyOrgChanges,
        notifyTaskAssigned: memberships.notifyTaskAssigned,
      })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, ctx.tenantId)))
      .where(eq(users.id, ctx.userId));
    if (!row) throw new NotFoundException('Profile not found');
    return row;
  }

  /**
   * Updates the caller's own profile; `defaultFunnelId` and the notification settings
   * (`dailyDigest`, `notifyDealAssigned`, CD-16; `notifyMeetingInvites`, `notifyVisitPlans`, CD-207; `notifyTaskAssigned`, CD-146) apply to this workspace only.
   */
  async updateProfile(ctx: TenantContext, user: AuthUser, input: UpdateProfile) {
    const { defaultFunnelId, dailyDigest, notifyDealAssigned, notifyMeetingInvites, notifyVisitPlans, notifyOrgChanges, notifyTaskAssigned, ...own } = input;
    const workspaceOnly = { defaultFunnelId, dailyDigest, notifyDealAssigned, notifyMeetingInvites, notifyVisitPlans, notifyOrgChanges, notifyTaskAssigned };
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
      if (Object.values(workspaceOnly).some((v) => v !== undefined)) {
        await tx
          .update(memberships)
          .set(workspaceOnly)
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId)));
      }
    });
    // The cached user (name) must not outlive the change.
    this.identity.forgetUser(user.authSubject);
    return this.getProfile(ctx);
  }
}
