// Members don't see the Workspace settings (CD-523): no tile in the module switcher, and their
// notification settings are on Personal preferences. Owners and admins keep both as before.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// modules.ts imports '../lib/paths' without an extension, as Vite allows; Node needs the `.ts`.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(/^\.\.?\/.*\/[^./]+$/.test(specifier) ? specifier + '.ts' : specifier, context);
  },
});
const { MODULES, switcherModules } = await import('../src/components/modules.ts');
const { paths } = await import('../src/lib/paths.ts');
hooks.deregister();

describe('Workspace settings for members (CD-523)', () => {
  it('leaves the Workspace settings tile out of the module switcher for members only', () => {
    assert.ok(!switcherModules('member').some((m) => m.settings));
    assert.deepEqual(
      switcherModules('member').map((m) => m.id),
      MODULES.filter((m) => !m.settings).map((m) => m.id),
    );
    for (const role of ['owner', 'admin']) assert.deepEqual(switcherModules(role), MODULES);
  });

  it('sends members to Personal preferences for their notification settings', () => {
    assert.equal(paths.notifications(true), paths.settings('notifications'));
    assert.equal(paths.notifications(false), paths.myNotifications);
    assert.ok(paths.myNotifications.startsWith(paths.profile + '#'));
  });
});
