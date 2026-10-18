/**
 * Time on a project without a task (CD-350): only when the workspace turns it on (Settings →
 * Workforce), for the project's team and its lead, on an open project. The hours show in the
 * Timesheet as the project's own row, count toward the project's logged hours, and appear in the
 * Report tab and the time report on a "No task" line.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf } from './people-helpers';

interface Loggable {
  kind: string;
  id: string;
  name: string;
  path: string;
}
interface Week {
  today: string;
  rows: { kind: string; id: string; minutes: number; lockedReason: string | null }[];
}

let owner: Session, ana: Session, marko: Session;
let tenant: string, anaId: string, projectId: string, today: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const setting = (on: boolean) => ok('PATCH', '/workspace', { ...as(), body: { timesheet: { projectTime: on } } });
const cell = (s: Session, minutes: number) => call<Week>('PUT', '/timesheet/cells', { ...as(s), body: { date: today, projectId, minutes } });

beforeAll(async () => {
  [owner, ana, marko] = await Promise.all([signIn('tpt-owner'), signIn('tpt-ana'), signIn('tpt-marko')]);
  tenant = await createTenant(owner, 'Project time');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, marko, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId: company.id } })).id;
  await ok('POST', `/projects/${projectId}/members`, { ...as(), body: { employeeIds: [anaId] } });
  today = (await ok<Week>('GET', '/timesheet/week', as(ana))).today;
});

describe('time on a project without a task (CD-350)', () => {
  it('is off by default: not in the picker, and refused', async () => {
    expect((await ok<{ timesheet: { projectTime: boolean } }>('GET', '/workspace', as())).timesheet.projectTime).toBe(false);
    expect((await ok<Loggable[]>('GET', '/timesheet/loggable', as(ana))).filter((i) => i.kind === 'project')).toEqual([]);
    expect((await cell(ana, 60)).status).toBe(403);
  });

  it("turned on, the project's team logs on the project itself; others can't", async () => {
    await setting(true);
    const picker = await ok<Loggable[]>('GET', '/timesheet/loggable', as(ana));
    expect(picker).toContainEqual(expect.objectContaining({ kind: 'project', id: projectId, name: 'No task', path: 'Kovin Pančevo › Service contract 2026' }));
    expect((await ok<Loggable[]>('GET', '/timesheet/loggable', as(marko))).filter((i) => i.kind === 'project')).toEqual([]);
    const saved = await cell(ana, 120);
    expect(saved.status).toBe(200);
    expect(saved.body.rows.find((r) => r.kind === 'project' && r.id === projectId)).toMatchObject({ minutes: 120, lockedReason: null });
    expect((await cell(marko, 60)).status).toBe(403);
    // Someone assigned to one of its tasks may log on the project too (owner, 18 Oct).
    const markoId = (await accessOf(marko, tenant)).employeeId;
    const task = await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId, name: 'Survey', assigneeIds: [markoId] } });
    expect((await ok<Loggable[]>('GET', '/timesheet/loggable', as(marko))).filter((i) => i.kind === 'project').map((i) => i.id)).toEqual([projectId]);
    expect((await cell(marko, 60)).status).toBe(200);
    await cell(marko, 0);
    await ok('PATCH', `/tasks/${task.id}/assignees/${markoId}`, { ...as(), body: { active: false } }).catch(() => undefined);
    // An empty row can be added from the dialog too.
    expect((await call('POST', '/timesheet/rows', { ...as(ana), body: { weekStart: (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(ana))).thisWeek, projectId } })).status).toBe(201);
  });

  it('counts toward the project: its logged hours, the Report tab and the time report', async () => {
    const project = await ok<{ loggedMinutes: number }>('GET', `/projects/${projectId}`, as());
    expect(project.loggedMinutes).toBe(120);
    const report = await ok<{ summary: { loggedMinutes: number }; stages: { name: string; loggedMinutes: number }[] }>('GET', `/projects/${projectId}/report`, as());
    expect(report.summary.loggedMinutes).toBe(120);
    expect(report.stages).toContainEqual(expect.objectContaining({ name: 'No task', loggedMinutes: 120 }));
    const time = await ok<unknown>('GET', '/time-report?period=all', as());
    expect(JSON.stringify(time)).toContain('No task');
  });

  it('a closed project takes no more time on it', async () => {
    await ok('PATCH', `/projects/${projectId}`, { ...as(), body: { status: 'completed' } });
    expect((await cell(ana, 180)).status).toBe(423);
    await ok('PATCH', `/projects/${projectId}`, { ...as(), body: { status: 'open' } });
  });

  it('turned off again, the hours stay but no new ones go on', async () => {
    await setting(false);
    expect((await cell(ana, 180)).status).toBe(403);
    expect((await ok<{ loggedMinutes: number }>('GET', `/projects/${projectId}`, as())).loggedMinutes).toBe(120);
  });
});
