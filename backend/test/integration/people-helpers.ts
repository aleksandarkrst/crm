import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { inject } from 'vitest';
import { addMember, ok, type Session } from './helpers';

/**
 * Helpers for the people tests (milestone 13). Org units and leftover assigned roles are made in
 * SQL as the runtime role where a test only needs them to exist, with the tenant set like
 * DatabaseService.withTenant (RLS applies).
 */

/** Runs SQL as the runtime role in one committed transaction with app.tenant_id = tenant. */
export async function asTenantSql<T = Record<string, unknown>>(tenant: string, text: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: inject('databaseUrl') });
  await db.connect();
  try {
    await db.query('begin');
    await db.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    const { rows } = await db.query(text, params);
    await db.query('commit');
    return rows as T[];
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

/**
 * The workspace's level at `position` (1 = top), making the default levels Department and Team
 * first when it has none (as GET /people/org-levels does).
 */
export async function levelAt(tenant: string, position: number): Promise<string> {
  await asTenantSql(
    tenant,
    `insert into org_levels (tenant_id, position, name)
       select $1, p, n from (values (1, 'Department'), (2, 'Team')) v(p, n)
       where not exists (select 1 from org_levels where tenant_id = $1)`,
    [tenant],
  );
  const [row] = await asTenantSql<{ id: string }>(tenant, `select id from org_levels where tenant_id = $1 order by position offset $2 limit 1`, [tenant, position - 1]);
  return row!.id;
}

/** An org unit (CD-226) made in SQL: of the level at `level`, inside `parentId` when given. */
export async function createUnit(tenant: string, name: string, opts: { level?: number; parentId?: string | null; code?: string | null } = {}): Promise<string> {
  const levelId = await levelAt(tenant, opts.level ?? 1);
  const [row] = await asTenantSql<{ id: string }>(tenant, `insert into org_units (tenant_id, level_id, parent_id, name, code) values ($1, $2, $3, $4, $5) returning id`, [
    tenant,
    levelId,
    opts.parentId ?? null,
    name,
    opts.code ?? null,
  ]);
  return row!.id;
}

/** A unit of the top level (Department by default). */
export const createDepartment = (tenant: string, name: string, code: string | null = null) => createUnit(tenant, name, { level: 1, code });

/** A unit of the second level (Team by default) inside `departmentId`. */
export const createTeam = (tenant: string, departmentId: string, name: string) => createUnit(tenant, name, { level: 2, parentId: departmentId });

export async function grantRole(tenant: string, employeeId: string, role: 'administration' | 'payroll') {
  await asTenantSql(tenant, `insert into employee_roles (tenant_id, employee_id, role) values ($1, $2, $3)`, [tenant, employeeId, role]);
}

/** The caller's own access: `{ employeeId, roles, directReportIds, reportIds }`. */
export async function accessOf(s: Session, tenant: string) {
  return ok('GET', '/people/access', { token: s.token, tenant });
}

/** Adds `invitee` as a member and returns their (automatically created and linked) employee id. */
export async function joinAsEmployee(owner: Session, tenant: string, invitee: Session, role: 'admin' | 'member' = 'member'): Promise<string> {
  await addMember(owner, tenant, invitee, role);
  const access = await accessOf(invitee, tenant);
  return access.employeeId as string;
}

/**
 * CD-226: the app shows only members, people with a pending invitation and people who left. A record
 * made directly with POST /people/employees (the API stays; the UI is gone) gets a pending
 * invitation here, so the list and the card show it (as Invited). No email is sent.
 */
export async function showInApp(tenant: string, employeeId: string): Promise<void> {
  await asTenantSql(tenant, `insert into invitations (tenant_id, email, role, token_hash, expires_at, employee_id) values ($1, $2, 'member', $3, now() + interval '7 days', $4)`, [
    tenant,
    `shown-${employeeId}@example.test`,
    randomBytes(32).toString('hex'),
    employeeId,
  ]);
}

/** POST /people/employees as `s` (start date filled in), shown in the app (`showInApp`); returns the id. */
export async function addEmployee(s: Session, tenant: string, body: Record<string, unknown>): Promise<string> {
  const { id } = await ok('POST', '/people/employees', { token: s.token, tenant, body: { employmentStartDate: START, ...body } });
  await showInApp(tenant, id);
  return id as string;
}

/** A valid start date (spec 4.2: required on create). */
export const START = '2024-03-01';
/** The spec's vectors (4.4). */
export const IBAN = 'RS35260005601001611379';
export const DOMESTIC = '260-0056010016113-79';
export const IBAN_MASK = 'RS35 •••• 1379';
