// Home's "Waiting for you" (CD-288): what needs this person, from the modules they can open.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

// waiting.ts imports '../lib/paths' without an extension, as Vite allows; Node needs the `.ts`.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(/^\.\.?\/.*\/[^./]+$/.test(specifier) ? specifier + '.ts' : specifier, context);
  },
});
const { lateLabel, periodLabel, waitingItems, whenLabel } = await import('../src/store/waiting.ts');
hooks.deregister();

const today = '2026-11-14'; // a Saturday
const ALL = new Set(['crm', 'projects', 'timesheet', 'timeoff']);
const task = (over: Record<string, unknown>) => ({ id: 't1', name: 'Measure the room', projectName: 'Alpha fit-out', dueDate: '2026-11-11', status: 'todo', ...over }) as never;
const timesheet = {
  weekStart: '2026-11-02',
  weekNumber: 45,
  deadline: { date: '2026-11-13', time: '12:00' },
  approvalMode: 'week',
  rows: [
    { employee: { id: 'e1', name: 'Jelena Savić' }, waiting: 5, approvable: true, enteredMinutes: 2400 },
    { employee: { id: 'e2', name: 'Bojan Jović' }, waiting: 0, approvable: false, enteredMinutes: 0 },
    { employee: { id: 'e3', name: 'Ana Ilić' }, waiting: 2, approvable: false, enteredMinutes: 960 },
  ],
} as never;
const timeOff = [{ id: 'r1', employee: { fullName: 'Nikola Kostić' }, workingDays: 3, startDate: '2026-11-26', endDate: '2026-11-28', submittedAt: '2026-11-13T09:00:00Z' }] as never;
const src = {
  today,
  open: ALL,
  crmTasks: [{ id: 'c1', title: 'Send the offer', due: '2026-11-10', leadId: 'd1', leadName: 'NIS' }],
  projectTasks: [task({}), task({ id: 't2', dueDate: '2026-11-20' }), task({ id: 't3', status: 'done' }), task({ id: 't4', dueDate: null })],
  timesheets: [timesheet],
  timeOff,
};

describe('Waiting for you (CD-288)', () => {
  it('lists what needs this person, oldest first, with where to act on it', () => {
    assert.deepEqual(
      waitingItems(src).map((w) => [w.module, w.text, w.meta, w.action, w.to]),
      [
        ['timesheet', 'Jelena Savić submitted week 45, 40 hours', 'Timesheet · Yesterday', 'Review', '/approvals/e1?week=2026-11-02'],
        ['crm', 'Send the offer, NIS', 'CRM · 4 days late', 'Open', '/deals/d1'],
        ['projects', 'Measure the room, Alpha fit-out', 'Projects · 3 days late', 'Open', '/tasks/t1'],
        ['timeoff', 'Nikola Kostić asks for 3 days off, 26 to 28 November', 'Time off · Yesterday', 'Review', '/timeoff?tab=approvals'],
      ],
    );
  });

  it('leaves out project tasks that are done, not due yet or without a due date, and weeks the person cannot approve', () => {
    const keys = waitingItems(src).map((w) => w.key);
    for (const k of ['task:t2', 'task:t3', 'task:t4']) assert.ok(!keys.includes(k), k);
    assert.ok(!keys.some((k) => k.startsWith('ts:e2') || k.startsWith('ts:e3')));
  });

  it('counts days in Day by day mode', () => {
    const day = { ...(timesheet as object), approvalMode: 'day', rows: [{ employee: { id: 'e1', name: 'Jelena Savić' }, waiting: 1, approvable: true, enteredMinutes: 60 }] } as never;
    assert.equal(waitingItems({ ...src, timesheets: [day] }).find((w) => w.module === 'timesheet')?.text, 'Jelena Savić submitted 1 day of week 45, 1 hour');
  });

  it('adds nothing from a module that is off or not theirs', () => {
    assert.deepEqual(
      waitingItems({ ...src, open: new Set(['crm']) }).map((w) => w.module),
      ['crm'],
    );
    assert.deepEqual(waitingItems({ ...src, open: new Set(), crmTasks: [] }), []);
  });

  it('says when as people do', () => {
    assert.equal(whenLabel('2026-11-14', today), 'Today');
    assert.equal(whenLabel('2026-11-13', today), 'Yesterday');
    assert.equal(whenLabel('2026-11-10', today), 'Tuesday');
    assert.equal(whenLabel('2026-10-12', today), '12 October');
    assert.equal(lateLabel('2026-11-13', today), '1 day late');
    assert.equal(periodLabel('2026-11-26', '2026-11-26'), '26 November');
    assert.equal(periodLabel('2026-10-30', '2026-11-02'), '30 October to 2 November');
  });
});
