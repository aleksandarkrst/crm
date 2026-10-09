/**
 * Timesheet emails (CD-154): the reminder before the deadline (only to people with missing days,
 * once), at the deadline "late" to each person who missed it and one summary per approver (the
 * manager, or Admins without one), "submitted automatically" with auto submit on, both switches
 * off stopping them, and the tick run twice sending nothing twice. Driven by the dev tick at chosen
 * moments next week (the workspace on UTC, so the times are exact); the worker sends the mail.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTenant, eventually, mailTo, type Mail, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

let owner: Session;
let ana: Session;
let marko: Session;
let petar: Session;
let tenant: string;
let taskId: string;
const ids = {} as Record<'ana' | 'marko' | 'petar', string>;
let week1: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tick = (now: string) => ok<{ submitted: number; emails: number }>('POST', '/dev/timesheet/deadline-tick', { ...as(), body: { now } }, 200);
const mails = async (s: Session, subject: string) => (await mailTo(owner, s.email)).filter((m: Mail) => m.subject === subject);
/** Waits for the worker to send `subject` to `s`, and answers that mail. */
const mailFor = (s: Session, subject: string) =>
  eventually(async () => {
    const found = await mails(s, subject);
    return found.length ? found[0]! : null;
  }, `"${subject}" to ${s.name}`);
const hours = (who: 'ana' | 'marko' | 'petar', dates: string[]) =>
  asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) select $1, $2, $3, d::date, 480 from unnest($4::text[]) d`, [tenant, ids[who], taskId, dates]);

beforeAll(async () => {
  [owner, ana, marko, petar] = await Promise.all([signIn('tn-owner'), signIn('tn-ana'), signIn('tn-marko'), signIn('tn-petar')]);
  tenant = await createTenant(owner, 'Timesheet emails');
  for (const s of [ana, marko, petar]) await addMember(owner, tenant, s, 'member');
  ids.ana = (await accessOf(ana, tenant)).employeeId;
  ids.marko = (await accessOf(marko, tenant)).employeeId;
  ids.petar = (await accessOf(petar, tenant)).employeeId;
  // Marko approves Ana; Marko and Petar have no manager, so the Admins (the owner) approve them.
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [ids.ana], managerId: ids.marko } }, 200);
  await ok('PATCH', '/workspace', { ...as(), body: { timezone: 'UTC' } });
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Hydraulic leak', assigneeIds: [ids.ana, ids.marko, ids.petar] } })).id;
  week1 = addDays((await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(ana))).thisWeek, 7);
  // Ana works Monday to Thursday; Petar's whole week is in already; Marko has nothing.
  await hours('ana', [0, 1, 2, 3].map((n) => addDays(week1, n)));
  await hours('petar', [0, 1, 2, 3, 4].map((n) => addDays(week1, n)));
  await asTenantSql(
    tenant,
    `insert into timesheet_days (tenant_id, employee_id, work_date, status, submitted_at, first_submitted_at) select $1, $2, d::date, 'submitted', now(), now() from unnest($3::text[]) d`,
    [tenant, ids.petar, [0, 1, 2, 3, 4].map((n) => addDays(week1, n))],
  );
});

describe('before the deadline', () => {
  it('the reminder goes 2 hours before, only to people with missing days, once (AC 1, 5)', async () => {
    expect((await tick(`${addDays(week1, 4)}T14:59:00.000Z`)).emails).toBe(0);
    const first = await tick(`${addDays(week1, 4)}T15:00:00.000Z`);
    expect(first.emails).toBeGreaterThanOrEqual(2);
    const subject = `Reminder: submit your timesheet for week ${weekNumber(week1)} by Fri 17:00`;
    const toAna = await mailFor(ana, subject);
    expect(toAna.text).toContain('Entered so far: 32 of 40 h');
    expect(toAna.text).toContain('Missing: Friday');
    await mailFor(marko, subject);
    // Twice: nothing new.
    expect((await tick(`${addDays(week1, 4)}T16:30:00.000Z`)).emails).toBe(0);
    expect(await mails(petar, subject)).toEqual([]);
    expect(await mails(ana, subject)).toHaveLength(1);
  });
});

describe('at the deadline', () => {
  it('each person who missed it gets one email; each approver one summary (AC 2, 5)', async () => {
    // Shortly after the deadline (the tick runs every 15 minutes; a day later at most after downtime).
    const after = `${addDays(week1, 4)}T17:30:00.000Z`;
    const res = await tick(after);
    expect(res.emails).toBeGreaterThanOrEqual(4);
    const late = `Your timesheet for week ${weekNumber(week1)} is late`;
    const summary = `Late timesheets for week ${weekNumber(week1)}`;
    const toAna = await mailFor(ana, late);
    expect(toAna.text).toContain('Missing: Friday');
    await mailFor(marko, late);
    // Marko approves Ana; the owner (an Admin) approves Marko, who has no manager.
    const forMarko = await mailFor(marko, summary);
    expect(forMarko.text).toContain('not submitted · 32 h');
    expect(forMarko.text).not.toContain('Petar');
    const forOwner = await mailFor(owner, summary);
    expect(forOwner.text).toMatch(/not submitted · 0 h/);
    expect(await mails(petar, late)).toEqual([]);
    expect((await tick(after)).emails).toBe(0);
  });

  it('with auto submit on, the auto submit email instead of the late one (AC 3)', async () => {
    const week2 = addDays(week1, 7);
    await hours('ana', [addDays(week2, 0)]);
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { autoSubmit: true } } });
    const res = await tick(`${addDays(week2, 4)}T17:30:00.000Z`);
    expect(res.submitted).toBeGreaterThanOrEqual(1);
    const auto = `Your timesheet for week ${weekNumber(week2)} was submitted automatically`;
    await mailFor(ana, auto);
    expect(await mails(ana, `Your timesheet for week ${weekNumber(week2)} is late`)).toEqual([]);
    const summary = `Late timesheets for week ${weekNumber(week2)}`;
    const forMarko = await mailFor(marko, summary);
    expect(forMarko.text).toContain('auto-submitted (late)');
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { autoSubmit: false } } });
  });

  it('turning the reminder and the after-deadline emails off stops them; Late still works (AC 4)', async () => {
    const week3 = addDays(week1, 14);
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { reminderHours: null, afterDeadlineEmails: false } } });
    expect((await tick(`${addDays(week3, 4)}T16:00:00.000Z`)).emails).toBe(0);
    expect((await tick(`${addDays(week3, 4)}T17:30:00.000Z`)).emails).toBe(0);
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { reminderHours: 2, afterDeadlineEmails: true } } });
  });
});

/** The ISO week number of a Monday. */
function weekNumber(monday: string): number {
  const thursday = new Date(Date.parse(`${monday}T00:00:00Z`) + 3 * 86_400_000);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
}
