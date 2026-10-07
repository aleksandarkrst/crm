import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { companies, deals, memberships, projects, projectStages, projectTypes, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import type { CreateProject, ListProjectsQuery, UpdateProject } from './projects.schemas';

const userName = (column: typeof projects.leadUserId) => sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${column})`;

/** What the API returns for a project. */
const columns = {
  id: projects.id,
  name: projects.name,
  status: projects.status,
  projectTypeId: projects.projectTypeId,
  projectTypeName: projectTypes.name,
  stageId: projects.stageId,
  stageName: projectStages.name,
  companyId: projects.companyId,
  companyName: companies.name,
  dealId: projects.dealId,
  dealTitle: deals.title,
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
    .where(where)
    .orderBy(asc(companies.name), desc(projects.createdAt));
}

async function assertMember(tx: Tx, ctx: TenantContext, userId: string): Promise<void> {
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)));
  if (!row) throw new BadRequestException('The project lead must be a member of this workspace');
}

/**
 * Client projects (CD-233, slimmed for CD-275): every member reads them and can create one; the
 * project lead, owners and admins change one. A project always has one CRM company and optionally
 * the deal it came from (a deal of that company that isn't lost). Creating one from a deal puts
 * "Project created · <name>" on the deal's timeline through the job
 * `projects.project-created-from-deal`, which the CRM handles (this module doesn't write CRM tables).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
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
        const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
        if (!company) throw new BadRequestException('Company not found');
        let deal: { id: string; title: string } | undefined;
        if (input.dealId) {
          const [row] = await tx.select({ id: deals.id, title: deals.title, companyId: deals.companyId, lostAt: deals.lostAt }).from(deals).where(eq(deals.id, input.dealId));
          if (!row) throw new BadRequestException('Deal not found');
          if (row.companyId !== input.companyId) throw new BadRequestException("The deal belongs to another company. Pick one of this company's deals.");
          if (row.lostAt) throw new BadRequestException('A lost deal can’t start a project. Reopen it first.');
          deal = row;
        }
        const leadUserId = input.leadUserId ?? ctx.userId;
        await assertMember(tx, ctx, leadUserId);
        const [stage] = await tx
          .select({ id: projectStages.id })
          .from(projectStages)
          .where(eq(projectStages.projectTypeId, input.projectTypeId))
          .orderBy(asc(projectStages.position))
          .limit(1);
        if (!stage) throw new BadRequestException('Project type not found');
        const [row] = await tx
          .insert(projects)
          .values({
            tenantId: ctx.tenantId,
            name: input.name,
            projectTypeId: input.projectTypeId,
            stageId: stage.id,
            companyId: input.companyId,
            dealId: deal?.id ?? null,
            leadUserId,
            createdByUserId: ctx.userId,
          })
          .returning({ id: projects.id });
        await this.audit.record(tx, ctx, { action: 'project.created', entityType: 'project', entityId: row!.id, data: { ...input, leadUserId } });
        if (deal) await this.jobs.send('projects.project-created-from-deal', { tenantId: ctx.tenantId, dealId: deal.id, projectId: row!.id, projectName: input.name, actorUserId: ctx.userId }, tx);
        return this.find(tx, row!.id);
      })
      .catch(mapDbError);
  }

  /** The lead, owners and admins: rename, lead, stage (one of its type's), status. */
  update(ctx: TenantContext, id: string, input: UpdateProject) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const current = await this.find(tx, id);
        if (current.leadUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) throw new ForbiddenException('Only the project lead, owners and admins can change this project');
        if (input.leadUserId) await assertMember(tx, ctx, input.leadUserId);
        if (input.stageId) {
          const [stage] = await tx
            .select({ id: projectStages.id })
            .from(projectStages)
            .where(and(eq(projectStages.id, input.stageId), eq(projectStages.projectTypeId, current.projectTypeId)));
          if (!stage) throw new BadRequestException("Pick a stage of the project's type");
        }
        await tx.update(projects).set(input).where(eq(projects.id, id));
        await this.audit.record(tx, ctx, { action: 'project.updated', entityType: 'project', entityId: id, data: input });
        return this.find(tx, id);
      })
      .catch(mapDbError);
  }

  private async find(tx: Tx, id: string): Promise<ProjectView> {
    const [row] = await selectProjects(tx, eq(projects.id, id));
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }
}
