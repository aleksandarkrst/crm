/**
 * What a workspace calls projects and tasks (CD-143): singular and plural names in the workspace
 * settings, Project / Projects / Task / Tasks by default; owners and admins rename them; 1–30
 * characters, and a task name can't repeat a project name; the audit keeps the old names. The live
 * hint is in events.spec.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { asTenantSql } from './people-helpers';

let owner: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const DEFAULTS = { project: 'Project', projects: 'Projects', task: 'Task', tasks: 'Tasks' };

beforeAll(async () => {
  [owner, member] = await Promise.all([signIn('terms-owner'), signIn('terms-member')]);
  tenant = await createTenant(owner, 'Terms');
  await addMember(owner, tenant, member, 'member');
});

describe('workspace terms', () => {
  it('are Project / Projects / Task / Tasks by default, for every member', async () => {
    expect((await ok('GET', '/workspace', as(member))).terms).toEqual(DEFAULTS);
  });

  it('owners and admins rename them; members get 403', async () => {
    const terms = { project: 'Job', projects: 'Jobs', task: 'Work order', tasks: 'Work orders' };
    expect((await call('PATCH', '/workspace', { ...as(member), body: { terms } })).status).toBe(403);
    expect((await ok('PATCH', '/workspace', { ...as(), body: { terms } }, 200)).terms).toEqual(terms);
    expect((await ok('GET', '/workspace', as(member))).terms).toEqual(terms);
  });

  it('refuses empty, too long and repeated names, and changes nothing', async () => {
    const before = (await ok('GET', '/workspace', as())).terms;
    for (const terms of [
      { ...DEFAULTS, task: ' ' },
      { ...DEFAULTS, projects: 'x'.repeat(31) },
      { ...DEFAULTS, task: 'project' },
      { project: 'Job', projects: 'Jobs', task: 'Task' },
    ]) {
      expect((await call('PATCH', '/workspace', { ...as(), body: { terms } })).status).toBe(400);
    }
    expect((await ok('GET', '/workspace', as())).terms).toEqual(before);
  });

  it('Reset to defaults sends the defaults; the audit keeps the old and new names', async () => {
    const before = (await ok('GET', '/workspace', as())).terms;
    expect((await ok('PATCH', '/workspace', { ...as(), body: { terms: DEFAULTS } }, 200)).terms).toEqual(DEFAULTS);
    const [row] = await asTenantSql<{ data: { terms: unknown; previousTerms: unknown } }>(tenant, `select data from audit_logs where action = 'workspace.updated' order by created_at desc limit 1`);
    expect(row!.data).toMatchObject({ terms: DEFAULTS, previousTerms: before });
  });
});
