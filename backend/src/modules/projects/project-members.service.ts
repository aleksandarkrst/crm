import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, orgUnits, projectMembers, projects } from '../../shared/database/schema';

/** POST /api/projects/:id/members: employees to add (already on the team: unchanged). */
export const AddProjectMembers = z.object({ employeeIds: z.array(z.uuid()).min(1, 'Pick at least one person').max(100) });
export type AddProjectMembers = z.infer<typeof AddProjectMembers>;

/** PATCH /api/projects/:id/members/:employeeId: the role on this project (empty clears it) and the hours a week. */
export const UpdateProjectMember = z
  .object({
    role: z
      .string()
      .trim()
      .max(100, 'At most 100 characters')
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    hoursPerWeek: z.number().min(0, "Can't be negative").max(80, 'At most 80 hours a week'),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type UpdateProjectMember = z.infer<typeof UpdateProjectMember>;

/**
 * A person's load: the hours a week they give every open project, summed, against their weekly
 * hours (Team tab, "Load, all projects").
 */
const loadHours = sql<number>`(select coalesce(sum(m2.hours_per_week), 0)::float from ${projectMembers} m2 join ${projects} p2 on p2.id = m2.project_id where m2.employee_id = ${employees.id} and p2.status = 'open')`;

const memberColumns = {
  employeeId: projectMembers.employeeId,
  name: employees.fullName,
  jobTitle: employees.jobTitle,
  team: orgUnits.name,
  active: sql<boolean>`${employees.deactivatedAt} is null`,
  role: projectMembers.role,
  hoursPerWeek: projectMembers.hoursPerWeek,
  weeklyHours: employees.weeklyHours,
  loadHours,
};

export type ProjectMemberView = Awaited<ReturnType<typeof selectMembers>>[number];

function selectMembers(tx: Tx, projectId: string) {
  return tx
    .select(memberColumns)
    .from(projectMembers)
    .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
    .leftJoin(orgUnits, eq(orgUnits.id, employees.unitId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(employees.fullName));
}

/**
 * A project's team (CD-271): everyone reads it; the project lead, owners and admins add people from
 * the org chart, set their role and hours a week, and remove them. Live updates come from the
 * table's triggers (hint `project`).
 */
@Injectable()
export class ProjectMembersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: TenantContext, projectId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.project(tx, projectId);
      return selectMembers(tx, projectId);
    });
  }

  add(ctx: TenantContext, projectId: string, input: AddProjectMembers) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.canChange(tx, ctx, projectId);
        const ids = [...new Set(input.employeeIds)];
        const found = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt }).from(employees).where(inArray(employees.id, ids));
        if (found.length !== ids.length) throw new BadRequestException('Employee not found');
        if (found.some((e) => e.deactivatedAt)) throw new BadRequestException("Someone who left can't join a project");
        await tx
          .insert(projectMembers)
          .values(ids.map((employeeId) => ({ tenantId: ctx.tenantId, projectId, employeeId })))
          .onConflictDoNothing();
        await this.audit.record(tx, ctx, { action: 'project.members_added', entityType: 'project', entityId: projectId, data: { employeeIds: ids } });
        return selectMembers(tx, projectId);
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, projectId: string, employeeId: string, input: UpdateProjectMember) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.canChange(tx, ctx, projectId);
        const [row] = await tx
          .update(projectMembers)
          .set(input)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.employeeId, employeeId)))
          .returning({ employeeId: projectMembers.employeeId });
        if (!row) throw new NotFoundException('Not on this project');
        await this.audit.record(tx, ctx, { action: 'project.member_updated', entityType: 'project', entityId: projectId, data: { employeeId, ...input } });
        return selectMembers(tx, projectId);
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, projectId: string, employeeId: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.canChange(tx, ctx, projectId);
        const [row] = await tx
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.employeeId, employeeId)))
          .returning({ employeeId: projectMembers.employeeId });
        if (!row) throw new NotFoundException('Not on this project');
        await this.audit.record(tx, ctx, { action: 'project.member_removed', entityType: 'project', entityId: projectId, data: { employeeId } });
        return selectMembers(tx, projectId);
      })
      .catch(mapDbError);
  }

  private async project(tx: Tx, projectId: string) {
    const [p] = await tx.select({ leadUserId: projects.leadUserId }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async canChange(tx: Tx, ctx: TenantContext, projectId: string) {
    const p = await this.project(tx, projectId);
    if (p.leadUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) throw new ForbiddenException("Only the project lead, owners and admins can change the project's team");
  }
}
