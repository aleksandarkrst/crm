import { BadRequestException, ConflictException } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { departments, employees, teams } from '../../shared/database/schema';

/**
 * Heads and leads belong where they head (CD-225):
 * - making someone head of a department puts them in it (keeping their team only when it is in
 *   that department); making someone lead of a team puts them in the team and its department
 *   (`placeHead`, `placeLead`);
 * - moving a head or lead somewhere else (the card, bulk "Set department and team", "Add people",
 *   drag and drop, or heading another department) would end that role, so it is refused with 409
 *   `heads_department` naming the roles, unless the caller sends `clearHeadRoles: true`; then the
 *   roles are cleared in the same transaction (`checkHeadMoves`).
 * History rows come from the tables' triggers.
 */

/** Where someone is, or will be. */
export interface Placement {
  departmentId: string | null;
  teamId: string | null;
}

/** A person about to move: their name and current place. */
export interface HeadMove {
  employeeId: string;
  fullName: string;
  from: Placement;
  to: Placement;
}

interface LostRole {
  kind: 'department' | 'team';
  id: string;
  name: string;
}

/**
 * Which of the person's head and lead roles a move ends: a department they head that they leave,
 * a team they lead in a department they leave, or another team they lead when they change team.
 */
export async function lostRoles(tx: Tx, move: Omit<HeadMove, 'fullName'>): Promise<LostRole[]> {
  const headed = await tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.headEmployeeId, move.employeeId)).orderBy(asc(departments.name));
  const led = await tx.select({ id: teams.id, name: teams.name, departmentId: teams.departmentId }).from(teams).where(eq(teams.leadEmployeeId, move.employeeId)).orderBy(asc(teams.name));
  const teamChanges = move.to.teamId !== move.from.teamId;
  return [
    ...headed.filter((d) => d.id !== move.to.departmentId).map((d) => ({ kind: 'department' as const, id: d.id, name: d.name })),
    ...led.filter((t) => t.departmentId !== move.to.departmentId || (teamChanges && t.id !== move.to.teamId)).map((t) => ({ kind: 'team' as const, id: t.id, name: t.name })),
  ];
}

/** "head of Sales and lead of Inside sales". */
const describe = (roles: LostRole[]) => {
  const parts = roles.map((r) => `${r.kind === 'department' ? 'head' : 'lead'} of ${r.name}`);
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
};

/**
 * Before writing moves: refuses (409 `heads_department`) when one would end a head or lead role,
 * unless `clear`; with `clear`, removes them as head or lead. The message names the first person
 * ("Ana Petrović is head of Sales. Moving them to Service removes them as head of Sales."), the
 * body lists everyone (`people`).
 */
export async function checkHeadMoves(tx: Tx, moves: HeadMove[], clear: boolean): Promise<void> {
  const affected: { employeeId: string; fullName: string; roles: LostRole[]; to: Placement }[] = [];
  for (const m of moves) {
    const roles = await lostRoles(tx, m);
    if (roles.length) affected.push({ employeeId: m.employeeId, fullName: m.fullName, roles, to: m.to });
  }
  if (!affected.length) return;
  if (clear) {
    const deptIds = affected.flatMap((a) => a.roles.filter((r) => r.kind === 'department').map((r) => r.id));
    const teamIds = affected.flatMap((a) => a.roles.filter((r) => r.kind === 'team').map((r) => r.id));
    if (deptIds.length) await tx.update(departments).set({ headEmployeeId: null }).where(inArray(departments.id, deptIds));
    if (teamIds.length) await tx.update(teams).set({ leadEmployeeId: null }).where(inArray(teams.id, teamIds));
    return;
  }
  const first = affected[0]!;
  const where = await placeName(tx, first.to);
  const more = affected.length > 1 ? ` (and ${affected.length - 1} more)` : '';
  throw new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'heads_department',
    message: `${first.fullName} is ${describe(first.roles)}. Moving them ${where} removes them as ${describe(first.roles)}${more}.`,
    people: affected.map((a) => ({ employeeId: a.employeeId, fullName: a.fullName, roles: a.roles })),
  });
}

/** "to Service", "to Inside sales", "out of every department". */
async function placeName(tx: Tx, to: Placement): Promise<string> {
  if (to.teamId) {
    const [t] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, to.teamId));
    if (t) return `to ${t.name}`;
  }
  if (to.departmentId) {
    const [d] = await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, to.departmentId));
    if (d) return `to ${d.name}`;
  }
  return 'out of their department';
}

async function current(tx: Tx, employeeId: string) {
  const [e] = await tx
    .select({ id: employees.id, fullName: employees.fullName, departmentId: employees.departmentId, teamId: employees.teamId })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .for('no key update');
  if (!e) throw new BadRequestException('Employee not found');
  return e;
}

/**
 * Puts a new department head in that department (CD-225). Their team stays when it belongs to the
 * department, else it is cleared. Roles elsewhere they would lose go through `checkHeadMoves`.
 * Call after the department row exists and before setting `head_employee_id` (so it doesn't count
 * as a role being lost).
 */
export async function placeHead(tx: Tx, employeeId: string, departmentId: string, clear: boolean): Promise<void> {
  const e = await current(tx, employeeId);
  let teamId = e.teamId;
  if (teamId) {
    const [t] = await tx.select({ departmentId: teams.departmentId }).from(teams).where(eq(teams.id, teamId));
    if (t?.departmentId !== departmentId) teamId = null;
  }
  const to = { departmentId, teamId };
  if (e.departmentId === to.departmentId && e.teamId === to.teamId) return;
  await checkHeadMoves(tx, [{ employeeId, fullName: e.fullName, from: e, to }], clear);
  await tx.update(employees).set(to).where(eq(employees.id, employeeId));
}

/** Puts a new team lead in the team and its department (CD-225); see `placeHead`. */
export async function placeLead(tx: Tx, employeeId: string, teamId: string, clear: boolean): Promise<void> {
  const e = await current(tx, employeeId);
  const [t] = await tx.select({ departmentId: teams.departmentId }).from(teams).where(eq(teams.id, teamId));
  if (!t) throw new BadRequestException('Team not found');
  const to = { departmentId: t.departmentId, teamId };
  if (e.departmentId === to.departmentId && e.teamId === to.teamId) return;
  await checkHeadMoves(tx, [{ employeeId, fullName: e.fullName, from: e, to }], clear);
  await tx.update(employees).set(to).where(eq(employees.id, employeeId));
}
