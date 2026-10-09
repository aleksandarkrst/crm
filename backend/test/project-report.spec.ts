import { describe, expect, it } from 'vitest';
import { projectReport, type ReportTask, workloadCells } from '../src/modules/projects/project-report';

const h = (hours: number) => hours * 60;
let n = 0;
const task = (over: Partial<ReportTask> & { logged?: Map<string, number> }): ReportTask => ({
  id: `t${++n}`,
  stageId: 'build',
  status: 'in_progress',
  startDate: null,
  dueDate: null,
  estimateMinutes: h(10),
  assigneeIds: ['ana'],
  logged: new Map(),
  ...over,
});
const stages = [
  { id: 'design', name: 'Design', position: 1 },
  { id: 'build', name: 'Build', position: 2 },
];
const report = (tasks: ReportTask[], over: Partial<Parameters<typeof projectReport>[0]> = {}) =>
  projectReport({ tasks, stages, people: new Map([['ana', 'Ana'], ['marko', 'Marko']]), today: '2026-10-09', budgetHours: 100, endDate: '2026-12-01', open: true, ...over });

describe('project Report tab (CD-261, design v2 §2)', () => {
  it('by stage: tasks done / total, estimate, logged, remaining on open tasks, done by estimate, latest due', () => {
    const r = report([
      task({ stageId: 'design', status: 'done', estimateMinutes: h(8), logged: new Map([['ana', h(10)]]), dueDate: '2026-09-30' }),
      task({ stageId: 'design', estimateMinutes: h(12), logged: new Map([['ana', h(4)]]), dueDate: '2026-10-20' }),
      task({ stageId: null, estimateMinutes: null }),
    ]);
    expect(r.stages.map((s) => s.name)).toEqual(['Design', 'No stage']);
    expect(r.stages[0]).toMatchObject({ tasks: 2, doneTasks: 1, estimateMinutes: h(20), loggedMinutes: h(14), remainingMinutes: h(8), donePercent: 40, overEstimate: true, dueDate: '2026-10-20', lateTasks: 0 });
    expect(r.summary).toMatchObject({ estimateMinutes: h(20), loggedMinutes: h(14), remainingMinutes: h(8), donePercent: 40, variancePercent: 25, budgetMinutes: h(100) });
  });

  it('by person: the estimate is shared by the current people, logged is their own, vs estimate on done tasks only', () => {
    const r = report([
      task({ status: 'done', estimateMinutes: h(10), assigneeIds: ['ana', 'marko'], logged: new Map([['ana', h(6)], ['marko', h(4)]]) }),
      task({ estimateMinutes: h(6), assigneeIds: ['ana'], logged: new Map([['ana', h(1)]]), dueDate: '2026-10-01' }),
    ]);
    const [ana, marko] = r.people;
    expect(ana).toMatchObject({ name: 'Ana', openTasks: 1, lateTasks: 1, estimateMinutes: h(11), loggedMinutes: h(7), remainingMinutes: h(5), variancePercent: 20 });
    expect(marko).toMatchObject({ name: 'Marko', openTasks: 0, estimateMinutes: h(5), loggedMinutes: h(4), variancePercent: -20 });
  });

  it('someone removed from a task keeps their logged hours without a share of the estimate', () => {
    const r = report([task({ assigneeIds: ['ana'], logged: new Map([['marko', h(3)]]) })]);
    expect(r.people.find((p) => p.employeeId === 'marko')).toMatchObject({ estimateMinutes: 0, loggedMinutes: h(3), openTasks: 0 });
  });

  it('the forecast slips by the latest late task, plus 5 days with work on hold; none when closed or without an end', () => {
    const tasks = [task({ dueDate: '2026-10-02' }), task({ status: 'on_hold', dueDate: '2026-11-01' })];
    expect(report(tasks).summary.forecast).toEqual({ slipDays: 12, date: '2026-12-13' });
    expect(report(tasks).summary.onHoldTasks).toBe(1);
    expect(report(tasks, { open: false }).summary.forecast).toBeNull();
    expect(report(tasks, { endDate: null }).summary.forecast).toBeNull();
  });
});

describe('Workload (CD-261, design v2 §9)', () => {
  const weeks = ['2026-10-05', '2026-10-12', '2026-10-19'];
  it('spreads remaining hours evenly from the start (or today) to the due date, per week', () => {
    // 14 days from Fri 9 Oct to Thu 22 Oct: 3 days in the first week, 7, then 4.
    expect(workloadCells([{ startDate: '2026-10-01', dueDate: '2026-10-22', remainingMinutes: h(14) }], weeks, '2026-10-09')).toEqual([h(3), h(7), h(4)]);
  });

  it('late or undated work lands today; done work and work after the last week count nothing', () => {
    expect(workloadCells([{ startDate: null, dueDate: '2026-09-01', remainingMinutes: h(5) }], weeks, '2026-10-09')).toEqual([h(5), 0, 0]);
    expect(workloadCells([{ startDate: '2026-11-02', dueDate: null, remainingMinutes: h(5) }], weeks, '2026-10-09')).toEqual([0, 0, 0]);
    expect(workloadCells([{ startDate: null, dueDate: null, remainingMinutes: 0 }], weeks, '2026-10-09')).toEqual([0, 0, 0]);
  });
});
