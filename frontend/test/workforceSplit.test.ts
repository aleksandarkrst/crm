// Workforce split into Employees, Timesheet and Time off (CD-521): which module each page belongs
// to, who sees Team and Approvals in the sidebar, and the old module remembered in a browser.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// modules.ts imports '../lib/paths' without an extension, as Vite allows; Node needs the `.ts`.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(/^\.\.?\/.*\/[^./]+$/.test(specifier) ? specifier + '.ts' : specifier, context);
  },
});
const { MODULES, WORKSPACE_MODULES, lastModule, lockReason, navFor, routeModule } = await import('../src/components/modules.ts');
const { paths } = await import('../src/lib/paths.ts');
hooks.deregister();

const mod = (id: string) => MODULES.find((m) => m.id === id)!;
const labels = (id: string, role: string, seesTeam = false) => navFor(mod(id), role, seesTeam).map((n) => n.label);

describe('the Workforce split (CD-521)', () => {
  it('replaces Workforce with Employees, Timesheet and Time off', () => {
    assert.ok(!MODULES.some((m) => m.id === 'workforce'));
    assert.ok(!(WORKSPACE_MODULES as readonly string[]).includes('workforce'));
    for (const id of ['employees', 'timesheet', 'timeoff']) assert.ok((WORKSPACE_MODULES as readonly string[]).includes(id), id);
  });

  it('puts each page in its module', () => {
    const cases: [string, string][] = [
      [paths.team(), 'employees'],
      [paths.org(), 'employees'],
      [paths.employee('e1'), 'employees'],
      [paths.teamStatus(), 'employees'],
      [paths.timesheet(), 'timesheet'],
      [paths.approvals(), 'timesheet'],
      [paths.approval('e1'), 'timesheet'],
      [paths.timeOff(), 'timeoff'],
    ];
    for (const [path, id] of cases) assert.equal(routeModule(path.split('?')[0]!)?.id, id, path);
  });

  it('shows owners and admins every page; Team is theirs only', () => {
    for (const role of ['owner', 'admin']) {
      assert.deepEqual(labels('employees', role), ['Team', 'Org structure', "Today's status"]);
      assert.deepEqual(labels('timesheet', role), ['Timesheet', 'Approvals']);
      assert.deepEqual(labels('timeoff', role), ['Time off']);
    }
    assert.deepEqual(labels('employees', 'member', true), ['Org structure', "Today's status"]);
  });

  it('shows Approvals to managers only among members', () => {
    assert.deepEqual(labels('timesheet', 'member', true), ['Timesheet', 'Approvals']);
    assert.deepEqual(labels('timesheet', 'member', false), ['Timesheet']);
    assert.deepEqual(labels('employees', 'member', false), ['Org structure']);
  });

  it('turns each new module off on its own', () => {
    const on = ['crm', 'employees', 'timeoff'];
    assert.equal(lockReason(mod('employees'), 'member', on), null);
    assert.equal(lockReason(mod('timeoff'), 'member', on), null);
    assert.equal(lockReason(mod('timesheet'), 'member', on), 'off');
  });

  it('reads a remembered Workforce as Employees', () => {
    const store = new Map<string, string>([['crm.module.u1', 'workforce']]);
    const g = globalThis as { localStorage?: unknown };
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null };
    try {
      assert.equal(lastModule('u1')?.id, 'employees');
    } finally {
      delete g.localStorage;
    }
  });

  it('keeps old Members links working through Team', () => {
    assert.equal(paths.team(), '/team');
    assert.equal(paths.team(true), '/team?invite=1');
  });
});
