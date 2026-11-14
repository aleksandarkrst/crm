// Home (CD-288): one tile per module this person can open in the workspace, and nothing else.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// modules.ts imports '../lib/paths' without an extension, as Vite allows; Node needs the `.ts`.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(/^\.\.?\/.*\/[^./]+$/.test(specifier) ? specifier + '.ts' : specifier, context);
  },
});
const { WORKSPACE_MODULES, homeModules } = await import('../src/components/modules.ts');
const { paths } = await import('../src/lib/paths.ts');
hooks.deregister();

const ids = (role: string, modules?: readonly string[]) => homeModules(role, modules).map((m) => m.id);

describe('Home (CD-288)', () => {
  it('shows every built module that is on, then Workspace settings for owners and admins', () => {
    for (const role of ['owner', 'admin']) assert.deepEqual(ids(role, WORKSPACE_MODULES), ['crm', 'projects', 'employees', 'timesheet', 'timeoff', 'settings']);
  });

  it('leaves Workspace settings out for members (CD-523)', () => {
    assert.deepEqual(ids('member', WORKSPACE_MODULES), ['crm', 'projects', 'employees', 'timesheet', 'timeoff']);
  });

  it('leaves out modules turned off in Workspace settings and those not built yet', () => {
    assert.deepEqual(ids('member', ['crm', 'timeoff', 'planning', 'finance']), ['crm', 'timeoff']);
    assert.deepEqual(ids('owner', ['projects']), ['projects', 'settings']);
  });

  it('has no module tiles when none is on: only Settings, for owners and admins', () => {
    assert.deepEqual(ids('member', []), []);
    assert.deepEqual(ids('admin', []), ['settings']);
  });

  it('opens each module where the switcher does', () => {
    for (const m of homeModules('owner', WORKSPACE_MODULES)) assert.ok(m.to, `${m.id} has a page to open`);
  });

  it('is the root path, where sign-in and every unknown URL land', () => {
    assert.equal(paths.home, '/');
  });
});
