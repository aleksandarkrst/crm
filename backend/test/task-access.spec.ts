import { describe, expect, it } from 'vitest';
import { canAssign, canCreateTask, canManage, type TaskCaller, taskAccess, type TaskFacts } from '../src/modules/projects/task-access';
import { logTimeRefusal } from '../src/modules/projects/task-log';

/** Ana reports to Marko, who reports to Petar; Jovan is elsewhere. */
const caller = (over: Partial<TaskCaller> = {}): TaskCaller => ({
  userId: 'u-me',
  admin: false,
  employeeId: 'me',
  directReportIds: new Set(),
  reportIds: new Set(),
  ...over,
});
const marko = caller({ userId: 'u-marko', employeeId: 'marko', directReportIds: new Set(['ana']), reportIds: new Set(['ana']) });
const petar = caller({ userId: 'u-petar', employeeId: 'petar', directReportIds: new Set(['marko']), reportIds: new Set(['marko', 'ana']) });
const jovan = caller({ userId: 'u-jovan', employeeId: 'jovan' });
const task = (over: Partial<TaskFacts> = {}): TaskFacts => ({ leadUserId: 'u-lead', teamIds: ['team-1'], assigneeIds: ['ana'], ...over });

describe('task visibility (CD-146)', () => {
  it('owners and admins, the lead, the team and the assignees act', () => {
    expect(taskAccess(caller({ admin: true, employeeId: null }), task())).toBe('act');
    expect(taskAccess(caller({ userId: 'u-lead' }), task())).toBe('act');
    expect(taskAccess(caller({ employeeId: 'team-1' }), task())).toBe('act');
    expect(taskAccess(caller({ employeeId: 'ana' }), task())).toBe('act');
  });

  it('direct managers of an assignee act; indirect ones only read (TC 3)', () => {
    expect(taskAccess(marko, task())).toBe('act');
    expect(taskAccess(petar, task())).toBe('read');
  });

  it('anyone else sees nothing (TC 2), and removed assignees no longer count', () => {
    expect(taskAccess(jovan, task())).toBe('none');
    expect(taskAccess(caller({ employeeId: 'ana' }), task({ assigneeIds: [] }))).toBe('none');
    expect(taskAccess(marko, task({ assigneeIds: [] }))).toBe('none');
    // A member without an employee record sees only what they lead.
    expect(taskAccess(caller({ employeeId: null }), task())).toBe('none');
  });

  it('the team, the lead and admins create tasks; managers and others do not', () => {
    expect(canCreateTask(caller({ employeeId: 'team-1' }), task())).toBe(true);
    expect(canCreateTask(caller({ userId: 'u-lead' }), task())).toBe(true);
    expect(canCreateTask(caller({ admin: true }), task())).toBe(true);
    expect(canCreateTask(marko, task())).toBe(false);
    expect(canCreateTask(jovan, task())).toBe(false);
  });

  it('the lead and admins assign anyone; managers their direct reports; everyone themselves', () => {
    expect(canAssign(caller({ userId: 'u-lead' }), 'u-lead', 'jovan')).toBe(true);
    expect(canAssign(caller({ admin: true }), 'u-lead', 'jovan')).toBe(true);
    expect(canAssign(marko, 'u-lead', 'ana')).toBe(true);
    expect(canAssign(marko, 'u-lead', 'jovan')).toBe(false);
    expect(canAssign(petar, 'u-lead', 'ana')).toBe(false);
    expect(canAssign(jovan, 'u-lead', 'jovan')).toBe(true);
  });

  it('the lead and admins delete and move', () => {
    expect(canManage(caller({ userId: 'u-lead' }), 'u-lead')).toBe(true);
    expect(canManage(caller({ admin: true }), 'u-lead')).toBe(true);
    expect(canManage(caller({ employeeId: 'team-1' }), 'u-lead')).toBe(false);
  });
});

describe('canLogTime (CD-146 TC 5)', () => {
  const open = { taskStatus: 'in_progress', projectStatus: 'open', assignment: { active: true } };

  it('an active assignee on an open task in an open project may log time', () => {
    expect(logTimeRefusal(open)).toBeNull();
    expect(logTimeRefusal({ ...open, taskStatus: 'on_hold' })).toBeNull();
  });

  it('refuses a non-assignee, a removed assignee, a Done task, a closed project and a missing task', () => {
    expect(logTimeRefusal({ ...open, assignment: null })).toBe('not_assigned');
    expect(logTimeRefusal({ ...open, assignment: { active: false } })).toBe('not_assigned');
    expect(logTimeRefusal({ ...open, taskStatus: 'done' })).toBe('task_done');
    expect(logTimeRefusal({ ...open, projectStatus: 'completed' })).toBe('project_closed');
    expect(logTimeRefusal({ ...open, projectStatus: 'cancelled' })).toBe('project_closed');
    expect(logTimeRefusal(null)).toBe('not_found');
  });
});
