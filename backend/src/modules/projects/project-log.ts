import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { companies, employees, projectMembers, projects, taskAssignments, tasks } from '../../shared/database/schema';

/**
 * Who may log time on a project without a task (CD-350): only when the workspace allows it
 * (Settings → Workforce, `timesheet_project_time`), on an open project, by someone on the
 * project's team, its lead, or anyone assigned to one of its tasks (owner, 18 Oct). Hour limits are per task, so none apply here. Call inside
 * `DatabaseService.withTenant` (RLS).
 */

export type ProjectLogRefusal = 'not_allowed' | 'not_found' | 'not_on_team' | 'project_closed';

export interface ProjectLogFacts {
  /** The workspace setting. */
  allowed: boolean;
  projectStatus: string;
  /** On the project's team (project_members), its lead, or assigned to one of its tasks. */
  onTeam: boolean;
}

/** Pure: the setting is on, the project is open and the person is on its team or leads it (unit-tested). */
export function projectLogRefusal(facts: ProjectLogFacts | null): ProjectLogRefusal | null {
  if (facts && !facts.allowed) return 'not_allowed';
  if (!facts) return 'not_found';
  if (!facts.onTeam) return 'not_on_team';
  if (facts.projectStatus !== 'open') return 'project_closed';
  return null;
}

/** On the team, the lead, or an active assignee of one of its tasks: one SQL condition for the checks and the picker. */
const onTeam = (employeeId: string) =>
  or(
    sql`exists (select 1 from ${projectMembers} m where m.project_id = ${projects.id} and m.employee_id = ${employeeId})`,
    sql`exists (select 1 from ${taskAssignments} a join ${tasks} t on t.id = a.task_id where t.project_id = ${projects.id} and a.employee_id = ${employeeId} and a.active)`,
    sql`${projects.leadUserId} is not null and ${projects.leadUserId} = (select e.user_id from ${employees} e where e.id = ${employeeId})`,
  );

/** Why `employeeId` can't log time on `projectId` itself, or null. `allowed`: the workspace setting. */
export async function projectLogRefusalFor(tx: Tx, employeeId: string, projectId: string, allowed: boolean): Promise<ProjectLogRefusal | null> {
  if (!allowed) return projectLogRefusal({ allowed, projectStatus: 'open', onTeam: false });
  const [row] = await tx
    .select({ status: projects.status, onTeam: sql<boolean>`coalesce(${onTeam(employeeId)}, false)` })
    .from(projects)
    .where(eq(projects.id, projectId));
  return projectLogRefusal(row ? { allowed, projectStatus: row.status, onTeam: !!row.onTeam } : null);
}

/** The open projects `employeeId` can log time on without a task (the Timesheet's picker), with their company. */
export function loggableProjects(tx: Tx, employeeId: string) {
  return tx
    .select({ id: projects.id, code: projects.code, name: projects.name, companyName: companies.name })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(and(eq(projects.status, 'open'), onTeam(employeeId)))
    .orderBy(asc(projects.name));
}
