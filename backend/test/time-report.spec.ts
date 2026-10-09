import { describe, expect, it } from 'vitest';
import { alertLevel, blockMessage, crossing } from '../src/modules/projects/hour-limits';
import { limitAlertEmail } from '../src/modules/projects/project-jobs';
import { buildReport, csvCell, flagOf, periodRange, type ReportLeaf, reportCsv } from '../src/modules/projects/time-report';

const h = (hours: number) => Math.round(hours * 60);

let n = 0;
const leaf = (over: Partial<ReportLeaf>): ReportLeaf => ({
  projectId: 'p',
  projectName: 'Service contract',
  projectCode: null,
  companyName: 'Kovin',
  stageId: null,
  stageName: null,
  stagePosition: null,
  taskId: `t${++n}`,
  taskNumber: n,
  taskName: `Task ${n}`,
  taskStatus: 'in_progress',
  employeeId: 'ana',
  personName: 'Ana',
  active: true,
  limitMinutes: null,
  loggedMinutes: 0,
  approvedMinutes: 0,
  allTimeMinutes: 0,
  ...over,
});
const logged = (hours: number, over: Partial<ReportLeaf> = {}) => leaf({ loggedMinutes: h(hours), allTimeMinutes: h(hours), ...over });

describe('hour limit alerts (CD-149, spec 10.3)', () => {
  it('levels: below 80 %, from 80 %, from the limit; none without a limit', () => {
    expect([alertLevel(h(7.5), h(10)), alertLevel(h(8), h(10)), alertLevel(h(9.75), h(10)), alertLevel(h(10), h(10)), alertLevel(h(11.5), h(10))]).toEqual([0, 80, 80, 100, 100]);
    expect(alertLevel(h(50), null)).toBe(0);
  });

  it('emails once per crossing, only going up, the highest threshold crossed (TC 7, 8, 9)', () => {
    expect(crossing(0, 80)).toBe(80);
    expect(crossing(80, 80)).toBeNull(); // 8 h → 8.5 h sends nothing
    expect(crossing(80, 100)).toBe(100);
    expect(crossing(0, 100)).toBe(100); // 7 h → 10 h: "Hour limit reached" only
    expect(crossing(100, 0)).toBeNull(); // dropping sends nothing…
    expect(crossing(0, 80)).toBe(80); // …and crossing again sends again
  });

  it("Block mode's refusal names the hours left, the limit and the lead (TC 12)", () => {
    expect(blockMessage({ number: 142 }, h(6.5), h(8), 'Marko Petrović')).toBe('You have 1.5 h left on T-142 (limit 8 h). Ask Marko Petrović to raise your limit.');
    expect(blockMessage({ number: 142 }, h(9), h(8), null)).toBe('You have 0 h left on T-142 (limit 8 h). Ask the project lead to raise your limit.');
  });

  it('the emails: almost reached to the person, reached and over to the lead', () => {
    const base = { to: 'x@example.com', recipientName: 'Ana Petrović', personName: 'Ana Petrović', workspaceName: 'Kovin', appUrl: 'https://app.test/', task: { id: 'id1', number: 142, name: 'Hydraulic leak', project: 'Service contract', company: 'Kovin' } };
    const almost = limitAlertEmail({ ...base, self: true, level: 80, loggedMinutes: h(8), limitMinutes: h(10) });
    expect(almost.subject).toBe('Hour limit almost reached: T-142 Hydraulic leak');
    expect(almost.text).toContain('You have logged 8 h of your 10 h limit on T-142 Hydraulic leak (Service contract, Kovin).');
    expect(almost.text).toContain('80% of the limit is used.');
    expect(almost.text).toContain('https://app.test/tasks/id1');
    const over = limitAlertEmail({ ...base, recipientName: 'Marko', self: false, level: 100, loggedMinutes: h(11.5), limitMinutes: h(10) });
    expect(over.subject).toBe('Hour limit reached: T-142 Hydraulic leak');
    expect(over.text).toContain('Ana Petrović has logged 11.5 h, 1.5 h over their 10 h limit, on T-142');
    expect(over.text).toContain('"Hour limit warnings" is on in Settings → Notifications for Kovin');
  });
});

describe('report periods (CD-149)', () => {
  it('months, fiscal quarters and years, ranges; All time is no period', () => {
    expect(periodRange('all', '2026-10-09', 1)).toBeNull();
    expect(periodRange('this_month', '2026-10-09', 1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('last_month', '2026-01-09', 1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('this_month', '2028-02-10', 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('this_quarter', '2026-10-09', 1)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('this_quarter', '2026-10-09', 2)).toEqual({ from: '2026-08-01', to: '2026-10-31' });
    expect(periodRange('this_year', '2026-10-09', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('this_year', '2026-10-09', 4)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(periodRange('this_year', '2026-02-09', 4)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(periodRange('range', '2026-10-09', 1, '2026-09-01', '2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
  });
});

describe('the time report (CD-149, spec 10.2)', () => {
  it('totals by level: project › stage › task › person, and the person view (TC 1)', () => {
    const repair = { stageId: 's1', stageName: 'Repair', stagePosition: 1 };
    const t1 = { taskId: 'a', taskNumber: 1, taskName: 'Pump', ...repair };
    const leaves = [logged(5, { ...t1 }), logged(4, { ...t1, employeeId: 'marko', personName: 'Marko' }), logged(3, { taskId: 'b', taskNumber: 2, taskName: 'Valve', ...repair })];
    const r = buildReport(leaves, { groupBy: 'project', period: null });
    const [p] = r.rows;
    expect(p!.loggedMinutes).toBe(h(12));
    const [stage] = p!.children;
    expect([stage!.kind, stage!.name, stage!.loggedMinutes]).toEqual(['stage', 'Repair', h(12)]);
    expect(stage!.children.map((t) => [t.code, t.loggedMinutes])).toEqual([
      ['T-1', h(9)],
      ['T-2', h(3)],
    ]);
    expect(stage!.children[0]!.children.map((x) => [x.name, x.loggedMinutes])).toEqual([
      ['Ana', h(5)],
      ['Marko', h(4)],
    ]);
    const people = buildReport(leaves, { groupBy: 'person', period: null });
    expect(people.rows.map((x) => [x.name, x.loggedMinutes])).toEqual([
      ['Ana', h(8)],
      ['Marko', h(4)],
    ]);
    expect(people.rows[0]!.children[0]!.children.map((t) => t.code)).toEqual(['T-1', 'T-2']);
    expect(r.total.loggedMinutes).toBe(h(12));
  });

  it('period vs limit: Logged is the period, Remaining and Used % all time (TC 3)', () => {
    const r = buildReport([leaf({ limitMinutes: h(10), loggedMinutes: h(3), allTimeMinutes: h(9) })], { groupBy: 'project', period: { from: '2026-10-01', to: '2026-10-31' } });
    const person = r.rows[0]!.children[0]!.children[0]!;
    expect([person.loggedMinutes, person.remainingMinutes, person.usedPercent, person.flag]).toEqual([h(3), h(1), 90, 'eighty']);
  });

  it('a removed assignee keeps their hours, without a limit, and "Not assigned any more" (TC 4)', () => {
    const t = { taskId: 'a', taskNumber: 7 };
    const r = buildReport([logged(2, { ...t, limitMinutes: h(8) }), logged(4, { ...t, employeeId: 'marko', personName: 'Marko', active: false })], { groupBy: 'project', period: null });
    const task = r.rows[0]!.children[0]!;
    expect(task.loggedMinutes).toBe(h(6));
    expect(task.limitMinutes).toBe(h(8)); // only current people's limits make the task's
    expect(task.children.find((x) => x.name === 'Marko')).toMatchObject({ notAssigned: true, limitMinutes: null });
  });

  it('limits: a task needs every current person with a limit; a project sums the known ones, "partial" otherwise', () => {
    const full = { taskId: 'a', taskNumber: 1 };
    const half = { taskId: 'b', taskNumber: 2 };
    const r = buildReport(
      [leaf({ ...full, limitMinutes: h(8) }), leaf({ ...full, employeeId: 'marko', personName: 'Marko', limitMinutes: h(6) }), leaf({ ...half, limitMinutes: h(5) }), leaf({ ...half, employeeId: 'marko', personName: 'Marko' })],
      { groupBy: 'project', period: null },
    );
    const [p] = r.rows;
    expect(p!.children.map((t) => t.limitMinutes)).toEqual([h(14), null]);
    expect([p!.limitMinutes, p!.limitPartial, p!.remainingMinutes]).toEqual([h(14), true, null]);
  });

  it('flags: 80 %, reached, over; only over 80 % keeps those people', () => {
    expect([flagOf(h(7.5), h(10)), flagOf(h(8), h(10)), flagOf(h(10), h(10)), flagOf(h(11.5), h(10)), flagOf(h(11.5), null)]).toEqual([null, 'eighty', 'reached', 'over', null]);
    const r = buildReport([logged(9, { limitMinutes: h(10) }), logged(1, { limitMinutes: h(10) }), logged(30)], { groupBy: 'project', period: null, onlyOver80: true });
    expect(r.total.loggedMinutes).toBe(h(9));
  });

  it('CSV: BOM, the screen rows in order with subtotals, total, formula guard (TC 15)', () => {
    const r = buildReport([logged(11.5, { projectName: '=HYPERLINK("x")', taskNumber: 142, taskName: 'Leak', limitMinutes: h(10) })], { groupBy: 'project', period: null });
    const csv = reportCsv(r);
    expect(csv.startsWith('﻿Project,Phase,Task,Person,Limit (h),')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(5); // header, project, task, person, total
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",,,,10,,11.5,0,-1.5,115,Over limit +1.5 h,`);
    expect(lines[3]).toBe(`"'=HYPERLINK(""x"")",,T-142 Leak,Ana,10,,11.5,0,-1.5,115,Over limit +1.5 h,`);
    expect(lines[4]).toBe('Total,,,,10,,11.5,0,-1.5,115,Over limit +1.5 h,');
    expect([csvCell(-1.5), csvCell('-x'), csvCell('a,b')]).toEqual(['-1.5', "'-x", '"a,b"']);
  });
});
