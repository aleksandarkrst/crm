import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { companies, contacts, deals, memberships, projectAutoDeals, projectFiles, projects, projectStages, projectTypes, tasks, tenants, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import type { CreateProject, ListProjectsQuery, UpdateProject } from './projects.schemas';

const userName = (column: typeof projects.leadUserId) => sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${column})`;

/** What the API returns for a project. */
const columns = {
  id: projects.id,
  name: projects.name,
  code: projects.code,
  status: projects.status,
  cancelReason: projects.cancelReason,
  health: projects.health,
  value: projects.value,
  currency: projects.currency,
  budgetHours: projects.budgetHours,
  description: projects.description,
  startDate: sql<string | null>`${projects.startDate}::text`,
  endDate: sql<string | null>`${projects.endDate}::text`,
  projectTypeId: projects.projectTypeId,
  projectTypeName: projectTypes.name,
  stageId: projects.stageId,
  stageName: projectStages.name,
  companyId: projects.companyId,
  companyName: companies.name,
  dealId: projects.dealId,
  dealTitle: deals.title,
  /** The linked deal was lost after the project started (spec 3.2: the project shows "Deal lost"). */
  dealLost: sql<boolean>`${deals.lostAt} is not null`,
  /** The deal's primary contact (design v2 Linked card). */
  contactId: deals.primaryContactId,
  contactName: contacts.fullName,
  leadUserId: projects.leadUserId,
  leadName: userName(projects.leadUserId),
  createdAt: projects.createdAt,
  version: projects.updatedAt,
};

export type ProjectView = Awaited<ReturnType<typeof selectProjects>>[number];

function selectProjects(tx: Tx, where?: SQL) {
  return tx
    .select(columns)
    .from(projects)
    .innerJoin(projectTypes, eq(projectTypes.id, projects.projectTypeId))
    .innerJoin(projectStages, eq(projectStages.id, projects.stageId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .leftJoin(deals, eq(deals.id, projects.dealId))
    .leftJoin(contacts, eq(contacts.id, deals.primaryContactId))
    .where(where)
    .orderBy(asc(companies.name), desc(projects.createdAt));
}

async function isMember(tx: Tx, tenantId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
  return !!row;
}

async function assertMember(tx: Tx, tenantId: string, userId: string): Promise<void> {
  if (!(await isMember(tx, tenantId, userId))) throw new BadRequestException('The project lead must be a member of this workspace');
}

/** Spec 3.2: only a deal of the project's company, and not a lost one. */
async function checkDeal(tx: Tx, dealId: string, companyId: string): Promise<{ id: string; title: string; amount: string; currency: string }> {
  const [row] = await tx
    .select({ id: deals.id, title: deals.title, companyId: deals.companyId, lostAt: deals.lostAt, amount: deals.amount, currency: deals.currency })
    .from(deals)
    .where(eq(deals.id, dealId));
  if (!row) throw new BadRequestException('Deal not found');
  if (row.companyId !== companyId) throw new BadRequestException("The deal belongs to another company. Pick one of this company's deals.");
  if (row.lostAt) throw new BadRequestException('A lost deal can’t start a project. Reopen it first.');
  return row;
}

/** A project from a deal is worth the deal's amount, in its currency (none for an empty deal). */
const dealValue = (deal: { amount: string; currency: string }) => (Number(deal.amount) > 0 ? { value: deal.amount, currency: deal.currency } : {});

async function checkCompany(tx: Tx, companyId: string): Promise<void> {
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new BadRequestException('Company not found');
}

async function firstStage(tx: Tx, projectTypeId: string): Promise<string> {
  const [stage] = await tx.select({ id: projectStages.id }).from(projectStages).where(eq(projectStages.projectTypeId, projectTypeId)).orderBy(asc(projectStages.position)).limit(1);
  if (!stage) throw new BadRequestException('Project type not found');
  return stage.id;
}

/** The stage a completed project ends on (CD-282), as a won deal ends on the funnel's Won stage. */
async function lastStage(tx: Tx, projectTypeId: string): Promise<string> {
  const [stage] = await tx.select({ id: projectStages.id }).from(projectStages).where(eq(projectStages.projectTypeId, projectTypeId)).orderBy(desc(projectStages.position)).limit(1);
  if (!stage) throw new BadRequestException('Project type not found');
  return stage.id;
}

/**
 * "Create a project when a deal is won" (CD-233, spec 3.2), run by the worker for `crm.deal-won`
 * when the workspace has it on. Exactly one project per deal, ever: `project_auto_deals` gets the
 * deal in the same transaction (a reopened deal won again, or a retried job, finds it and stops).
 * The project: the deal's title (numbered when the company has an open project of that name), its
 * company and the deal, the first project type, the deal owner as lead (or the first owner or admin
 * when the owner is gone). A deal without a company, or lost again meanwhile, gets none.
 * Returns what the caller needs for the timeline entry and the owner's email.
 */
export async function autoCreateFromWonDeal(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<{ projectId: string; projectName: string; dealOwnerUserId: string | null; dealTitle: string } | null> {
  const [tenant] = await tx.select({ on: tenants.autoCreateProjects }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant?.on) return null;
  const [deal] = await tx
    .select({ id: deals.id, title: deals.title, companyId: deals.companyId, ownerUserId: deals.ownerUserId, lostAt: deals.lostAt, amount: deals.amount, currency: deals.currency })
    .from(deals)
    .where(eq(deals.id, dealId));
  if (!deal || deal.lostAt || !deal.companyId) return null;
  const claimed = await tx.insert(projectAutoDeals).values({ tenantId, dealId }).onConflictDoNothing().returning({ dealId: projectAutoDeals.dealId });
  if (!claimed.length) return null;

  const [type] = await tx.select({ id: projectTypes.id }).from(projectTypes).orderBy(asc(projectTypes.position)).limit(1);
  if (!type) return null;
  const stageId = await firstStage(tx, type.id);
  const ownerIsMember = deal.ownerUserId ? await isMember(tx, tenantId, deal.ownerUserId) : false;
  let leadUserId = ownerIsMember ? deal.ownerUserId : null;
  if (!leadUserId) {
    const [admin] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ['owner', 'admin'])))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    leadUserId = admin?.userId ?? null;
  }
  // The name is unique among the company's open projects: "Title", then "Title (2)", …
  const taken = new Set(
    (await tx.select({ name: projects.name }).from(projects).where(and(eq(projects.companyId, deal.companyId), eq(projects.status, 'open')))).map((p) => p.name.trim().toLowerCase()),
  );
  const base = deal.title.trim().slice(0, 190);
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i})`;

  const [row] = await tx
    .insert(projects)
    .values({ tenantId, name, projectTypeId: type.id, stageId, companyId: deal.companyId, dealId, leadUserId, createdByUserId: null, ...dealValue(deal) })
    .returning({ id: projects.id });
  await tx.update(projectAutoDeals).set({ projectId: row!.id }).where(eq(projectAutoDeals.dealId, dealId));
  return { projectId: row!.id, projectName: name, dealOwnerUserId: ownerIsMember ? deal.ownerUserId : null, dealTitle: deal.title };
}

/**
 * Client projects (CD-233): every member reads them and can create one; the project lead, owners
 * and admins change one; owners and admins delete one. A project always has one CRM company and
 * optionally the deal it came from (a deal of that company that isn't lost). Creating one from a
 * deal puts "Project created · <name>" on the deal's timeline through the job
 * `projects.project-created-from-deal`, which the CRM handles (this module doesn't write CRM tables).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
  ) {}

  /** Projects by company name, newest first; `dealId` / `companyId` narrow the list. */
  list(ctx: TenantContext, query: ListProjectsQuery) {
    const where = and(query.dealId ? eq(projects.dealId, query.dealId) : undefined, query.companyId ? eq(projects.companyId, query.companyId) : undefined);
    return this.database.withTenant(ctx.tenantId, (tx) => selectProjects(tx, where));
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.find(tx, id));
  }

  create(ctx: TenantContext, input: CreateProject) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await checkCompany(tx, input.companyId);
        const deal = input.dealId ? await checkDeal(tx, input.dealId, input.companyId) : undefined;
        const leadUserId = input.leadUserId ?? ctx.userId;
        await assertMember(tx, ctx.tenantId, leadUserId);
        const stageId = await firstStage(tx, input.projectTypeId);
        const [row] = await tx
          .insert(projects)
          .values({
            tenantId: ctx.tenantId,
            name: input.name,
            projectTypeId: input.projectTypeId,
            stageId,
            companyId: input.companyId,
            dealId: deal?.id ?? null,
            leadUserId,
            createdByUserId: ctx.userId,
            code: input.code ?? null,
            description: input.description ?? null,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            budgetHours: input.budgetHours == null ? null : String(input.budgetHours),
            // From a deal, the value starts as the deal's amount unless one was given.
            ...(input.value !== undefined ? { value: input.value == null ? null : String(input.value), currency: input.currency ?? null } : deal ? dealValue(deal) : { currency: input.currency ?? null }),
          })
          .returning({ id: projects.id });
        await this.audit.record(tx, ctx, { action: 'project.created', entityType: 'project', entityId: row!.id, data: { ...input, leadUserId } });
        if (deal) await this.jobs.send('projects.project-created-from-deal', { tenantId: ctx.tenantId, dealId: deal.id, projectId: row!.id, projectName: input.name, actorUserId: ctx.userId }, tx);
        return this.find(tx, row!.id);
      })
      .catch(mapDbError);
  }

  /** The lead, owners and admins. See UpdateProject for the rules of type, company and status. */
  update(ctx: TenantContext, id: string, input: UpdateProject) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const current = await this.find(tx, id);
        if (current.leadUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) throw new ForbiddenException('Only the project lead, owners and admins can change this project');
        // dealId is checked below, against the (new) company.
        const patch: Partial<typeof projects.$inferInsert> = {
          ...input,
          dealId: undefined,
          value: input.value === undefined ? undefined : input.value === null ? null : String(input.value),
          budgetHours: input.budgetHours === undefined ? undefined : input.budgetHours === null ? null : String(input.budgetHours),
        };

        if (input.leadUserId) await assertMember(tx, ctx.tenantId, input.leadUserId);

        // Type and stage: a new type starts at its first stage unless a stage of it comes along.
        const typeId = input.projectTypeId ?? current.projectTypeId;
        if (input.stageId || input.projectTypeId) {
          const stageId = input.stageId ?? (input.projectTypeId && input.projectTypeId !== current.projectTypeId ? await firstStage(tx, typeId) : current.stageId);
          const [stage] = await tx
            .select({ id: projectStages.id })
            .from(projectStages)
            .where(and(eq(projectStages.id, stageId), eq(projectStages.projectTypeId, typeId)));
          if (!stage) throw new BadRequestException("Pick a stage of the project's type");
          patch.stageId = stageId;
        } else if (input.status === 'completed' && current.status !== 'completed') {
          // Completing moves the project to its type's last stage (CD-282); reopening keeps it there.
          patch.stageId = await lastStage(tx, typeId);
        }

        // Company and deal (spec 3.2): another company clears the deal, unless one of its deals comes along.
        const companyId = input.companyId ?? current.companyId;
        if (input.companyId && input.companyId !== current.companyId) {
          await checkCompany(tx, input.companyId);
          patch.dealId = null;
        }
        if (input.dealId !== undefined) patch.dealId = input.dealId === null ? null : (await checkDeal(tx, input.dealId, companyId)).id;

        // Status: cancelling needs a reason; open and completed clear it.
        const status = input.status ?? current.status;
        if (status === 'cancelled') {
          if (!input.cancelReason && !(current.status === 'cancelled' && current.cancelReason)) throw new BadRequestException('Pick the reason the project was cancelled');
        } else if (input.cancelReason) {
          throw new BadRequestException('Only a cancelled project has a cancel reason');
        } else {
          patch.cancelReason = null;
        }

        await tx.update(projects).set(patch).where(eq(projects.id, id));
        // Another type: the tasks (CD-146) follow the project to its new stage, as their stages are the old type's.
        if (input.projectTypeId && input.projectTypeId !== current.projectTypeId) await tx.update(tasks).set({ stageId: patch.stageId }).where(eq(tasks.projectId, id));
        await this.audit.record(tx, ctx, { action: 'project.updated', entityType: 'project', entityId: id, data: input });
        return this.find(tx, id);
      })
      .catch(mapDbError);
  }

  /**
   * Owners and admins (the controller's @RequireTenant('admin')). Spec 3.2 refuses a project with
   * logged hours (409 "This project has logged hours. Archive it instead."); time entries come with
   * milestone 15, so today every project can be deleted.
   */
  async remove(ctx: TenantContext, id: string) {
    const keys = await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        // Its files' rows go with it (FK cascade); the stored bytes are removed after the commit.
        const files = await tx.select({ key: projectFiles.storageKey }).from(projectFiles).where(eq(projectFiles.projectId, id));
        const [row] = await tx.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id, name: projects.name });
        if (!row) throw new NotFoundException('Project not found');
        await this.audit.record(tx, ctx, { action: 'project.deleted', entityType: 'project', entityId: id, data: { name: row.name } });
        return files.map((f) => f.key);
      })
      .catch(mapDbError);
    for (const key of keys) await this.storage.delete(ctx.tenantId, key);
  }

  private async find(tx: Tx, id: string): Promise<ProjectView> {
    const [row] = await selectProjects(tx, eq(projects.id, id));
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }
}
