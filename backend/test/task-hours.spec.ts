import { describe, expect, it } from 'vitest';
import { hoursSummary, type PersonOnTask, usedLevel } from '../src/modules/projects/task-hours';
import { logTimeRefusal } from '../src/modules/projects/task-log';

const person = (employeeId: string, hourLimit: number | null, over: Partial<PersonOnTask> = {}): PersonOnTask => ({
  employeeId,
  name: employeeId[0]!.toUpperCase() + employeeId.slice(1),
  jobTitle: null,
  active: true,
  formerMember: false,
  hourLimit,
  ...over,
});
const hours = (entries: Record<string, [number, number?]>) => new Map(Object.entries(entries).map(([id, [logged, approved = 0]]) => [id, { logged, approved }]));
const all = { seesAll: true, me: null };

describe('People and hours (CD-147)', () => {
  it('sums two people, with the task limit and remaining (TC 1, TC 2)', () => {
    const s = hoursSummary([person('ana', 8), person('marko', 6)], hours({ ana: [5, 3], marko: [4] }), all);
    expect(s.rows.map((r) => [r.name, r.logged, r.approved, r.remaining])).toEqual([
      ['Ana', 5, 3, 3],
      ['Marko', 4, 0, 2],
    ]);
    expect(s.total).toEqual({ logged: 9, approved: 3, taskLimit: 14, remaining: 5, someWithoutLimit: false });
  });

  it('keeps a removed person who logged hours in the rows and the total (TC 3)', () => {
    const s = hoursSummary([person('ana', 8), person('marko', 6, { active: false })], hours({ ana: [5], marko: [4] }), all);
    expect(s.rows.map((r) => [r.name, r.active])).toEqual([
      ['Ana', true],
      ['Marko', false],
    ]);
    expect(s.total.logged).toBe(9);
    // A removed person without hours isn't listed.
    expect(hoursSummary([person('ana', 8), person('jovan', null, { active: false })], hours({}), all).rows.map((r) => r.name)).toEqual(['Ana']);
  });

  it('has no task limit when someone current has none (TC 4)', () => {
    const s = hoursSummary([person('ana', 8), person('jovan', null)], hours({ ana: [2] }), all);
    expect(s.total).toMatchObject({ taskLimit: null, remaining: null, someWithoutLimit: true });
    expect(s.rows[1]).toMatchObject({ remaining: null, usedPercent: null, level: null, over: false });
  });

  it('shows over the limit, and the bar levels at 80 % and 100 % (TC 5, TC 6)', () => {
    const [ana] = hoursSummary([person('ana', 8)], hours({ ana: [10.5] }), all).rows;
    expect(ana).toMatchObject({ remaining: -2.5, over: true, level: 'red', usedPercent: 131 });
    expect([usedLevel(7.75, 10), usedLevel(8, 10), usedLevel(10, 10)]).toEqual(['neutral', 'amber', 'red']);
  });

  it('an assignee without rights sees their own hours, the others by name, and the total (TC 7)', () => {
    const s = hoursSummary([person('ana', 8), person('marko', 6)], hours({ ana: [5], marko: [4] }), { seesAll: false, me: 'ana' });
    expect(s.rows.map((r) => [r.name, r.visible, r.logged, r.hourLimit])).toEqual([
      ['Ana', true, 5, 8],
      ['Marko', false, null, 6],
    ]);
    expect(s.total.logged).toBe(9);
  });

  it('limits are per person: one person at their limit is flagged, the other is not (TC 9)', () => {
    const s = hoursSummary([person('ana', 8), person('marko', 6)], hours({ ana: [8], marko: [4] }), all);
    expect(s.rows.map((r) => [r.name, r.level, r.remaining])).toEqual([
      ['Ana', 'red', 0],
      ['Marko', 'neutral', 2],
    ]);
  });
});

describe('canLogTime in Block mode (CD-147)', () => {
  const base = { taskStatus: 'in_progress', projectStatus: 'open' };
  it('refuses an entry past the person\'s own limit, only in Block mode', () => {
    const assignment = { active: true, hourLimit: 8 };
    expect(logTimeRefusal({ ...base, assignment, block: { logged: 7, hours: 1 } })).toBeNull();
    expect(logTimeRefusal({ ...base, assignment, block: { logged: 7, hours: 1.5 } })).toBe('over_limit');
    expect(logTimeRefusal({ ...base, assignment })).toBeNull();
    expect(logTimeRefusal({ ...base, assignment: { active: true, hourLimit: null }, block: { logged: 100, hours: 1 } })).toBeNull();
  });
});
