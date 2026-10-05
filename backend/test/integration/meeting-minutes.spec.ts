/**
 * Internal minutes of meetings (CD-132): reading and writing them, who may write them and when,
 * conflicting edits (If-Match), next steps made into deal tasks, the "Recorded"/"Missing" status
 * and the missingMinutes filter, the change history and the daily digest's "Minutes missing".
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Funnel, type Json, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let ana: Session; // member who takes part
let bo: Session; // member who doesn't
let outsider: Session;
let tenant: string;
let funnel: Funnel;
const as = (s: Session, headers?: Record<string, string>) => ({ token: s.token, tenant, headers });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const EPOCH = '"1970-01-01T00:00:00.000Z"';

const company = (name: string) => ok('POST', '/crm/companies', { ...as(owner), body: { name } });
const deal = (title: string, companyId: string) => ok('POST', '/crm/deals', { ...as(owner), body: { title, funnelId: funnel.id, companyId } });
/** A meeting organized by the owner with ana taking part; it started `startedAgo` ms ago. */
const meeting = async (companyId: string, over: Record<string, unknown> = {}, startedAgo = 2 * HOUR) => {
  const start = Date.now() - startedAgo;
  return ok('POST', '/crm/meetings', {
    ...as(owner),
    body: { title: 'Minutes meeting', type: 'visit', startsAt: iso(start), endsAt: iso(start + HOUR), companyId, internalUserIds: [ana.userId], ...over },
  });
};
const minutesUrl = (id: string) => `/crm/meetings/${id}/minutes/internal`;
const save = (s: Session, id: string, body: Record<string, unknown>, version?: string | null) =>
  call('PUT', minutesUrl(id), { ...as(s, version === undefined ? undefined : { 'if-match': version ? `"${version}"` : EPOCH }), body });
const step = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), text: 'Send the revised offer', ownerUserId: null, dueDate: null, ...over });

beforeAll(async () => {
  owner = await signIn('mom-owner');
  admin = await signIn('mom-admin');
  ana = await signIn('mom-ana');
  bo = await signIn('mom-bo');
  outsider = await signIn('mom-outsider');
  tenant = await createTenant(owner, 'Minutes');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  funnel = await firstFunnel(owner, tenant);
});

describe('reading and writing the internal minutes', () => {
  it('starts empty, saves the parts sent, and marks the meeting "recorded" once there is a summary', async () => {
    const co = await company('Minutes Co');
    const m = await meeting(co.id);
    expect(m).toMatchObject({ internalMinutes: 'missing', minutesUpdatedAt: null });
    expect(await ok('GET', minutesUrl(m.id), as(bo))).toEqual({ summary: '', agreements: '', nextSteps: [], updatedAt: null, updatedByName: null });

    const first = await save(ana, m.id, { agreements: '- Pilot in **November**\n- Price [list](https://example.com/prices)' }, null);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ summary: '', agreements: '- Pilot in **November**\n- Price [list](https://example.com/prices)', nextSteps: [], updatedByName: ana.name });
    expect(first.body.updatedAt).not.toBeNull();
    // Agreements alone don't make the minutes recorded.
    expect((await ok('GET', `/crm/meetings/${m.id}`, as(owner))).internalMinutes).toBe('missing');

    const owners = step({ ownerUserId: bo.userId, dueDate: '2026-12-01' });
    const second = await save(ana, m.id, { summary: 'We walked through the roadmap.', nextSteps: [owners] }, first.body.updatedAt);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ summary: 'We walked through the roadmap.', agreements: first.body.agreements, nextSteps: [{ ...owners, taskId: null }] });
    const read = await ok('GET', `/crm/meetings/${m.id}`, as(bo));
    expect(read.internalMinutes).toBe('recorded');
    expect(read.minutesUpdatedAt).toBe(second.body.updatedAt);
    expect(await ok('GET', minutesUrl(m.id), as(bo))).toEqual(second.body);

    // Blank text empties a part again.
    const blank = await save(ana, m.id, { summary: '   \n' });
    expect(blank.body.summary).toBe('');
    expect((await ok('GET', `/crm/meetings/${m.id}`, as(owner))).internalMinutes).toBe('missing');
  });

  it('validates lengths, next steps and their owners', async () => {
    const co = await company('Minutes Validation Co');
    const m = await meeting(co.id);
    const refused = async (body: Record<string, unknown>) => {
      const res = await save(owner, m.id, body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      return res.body;
    };
    await refused({});
    await refused({ summary: 'x'.repeat(10_001) });
    await refused({ agreements: 'x'.repeat(5_001) });
    await refused({ nextSteps: [step({ text: 'x'.repeat(501) })] });
    await refused({ nextSteps: [step({ id: 'not-a-uuid' })] });
    await refused({ nextSteps: [step({ dueDate: '1 Dec' })] });
    const dup = step();
    await refused({ nextSteps: [dup, dup] });
    expect((await refused({ nextSteps: [step({ ownerUserId: outsider.userId })] })).message).toMatch(/member of this workspace/);
    expect((await save(owner, m.id, { summary: 'x'.repeat(10_000), agreements: 'y'.repeat(5_000), nextSteps: [step({ text: 'z'.repeat(500) })] })).status).toBe(200);
    expect((await call('GET', minutesUrl('00000000-0000-4000-8000-000000000000'), as(owner))).status).toBe(404);
  });
});

describe('who may write the minutes, and when', () => {
  it('lets the organizer, internal participants, admins and owners write; other members only read', async () => {
    const co = await company('Minutes Permissions Co');
    const m = await meeting(co.id, { organizerUserId: ana.userId, internalUserIds: [] });
    const denied = await save(bo, m.id, { summary: 'Bo was here' });
    expect(denied.status).toBe(403);
    expect((await ok('GET', minutesUrl(m.id), as(bo))).summary).toBe('');
    expect((await save(ana, m.id, { summary: 'Organizer' })).status).toBe(200);
    expect((await save(admin, m.id, { summary: 'Admin' })).status).toBe(200);
    expect((await save(owner, m.id, { summary: 'Owner' })).status).toBe(200);
    expect((await ok('GET', minutesUrl(m.id), as(bo))).summary).toBe('Owner');
    // Another workspace can't see them.
    const theirs = await createTenant(outsider, 'Minutes other');
    expect((await call('GET', minutesUrl(m.id), { token: outsider.token, tenant: theirs })).status).toBe(404);
  });

  it('allows planned (preparation) and held meetings; a cancelled one is read-only', async () => {
    const co = await company('Minutes Status Co');
    const future = await meeting(co.id, {}, -2 * DAY);
    expect((await save(ana, future.id, { summary: 'Prep notes' })).status).toBe(200);
    const past = await meeting(co.id);
    await ok('POST', `/crm/meetings/${past.id}/held`, as(owner), 200);
    expect((await save(ana, past.id, { summary: 'Held notes' })).status).toBe(200);

    await ok('POST', `/crm/meetings/${future.id}/cancel`, as(owner), 200);
    const refused = await save(ana, future.id, { summary: 'Too late' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/cancelled/);
    expect((await ok('GET', minutesUrl(future.id), as(ana))).summary).toBe('Prep notes');
  });
});

describe('conflicting edits', () => {
  it('refuses a save based on an older version when someone changed the same part, and merges other parts', async () => {
    const co = await company('Minutes Conflict Co');
    const m = await meeting(co.id);
    const base = (await save(owner, m.id, { summary: 'Base' }, null)).body;
    expect((await save(ana, m.id, { summary: 'Ana’s summary' }, base.updatedAt)).status).toBe(200);

    const res = await save(owner, m.id, { summary: 'Owner’s summary' }, base.updatedAt);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`${ana.name} changed this meeting while you were editing. Your change to the summary wasn't saved.`);
    expect(res.body.conflicts[0]).toMatchObject({ field: 'summary', value: 'Ana’s summary', changedBy: ana.name });

    // Another part merges; the same text sent again isn't a conflict.
    const merged = await save(owner, m.id, { agreements: 'Agreed', summary: 'Ana’s summary' }, base.updatedAt);
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body).toMatchObject({ summary: 'Ana’s summary', agreements: 'Agreed' });

    // Two people writing the first minutes at once: the second (based on "no minutes yet") conflicts.
    const fresh = await meeting(co.id);
    expect((await save(ana, fresh.id, { nextSteps: [step()] }, null)).status).toBe(200);
    const late = await save(owner, fresh.id, { nextSteps: [step({ text: 'Mine' })] }, null);
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/Your change to the next steps wasn't saved/);
  });
});

describe('next steps as deal tasks', () => {
  it('creates a task on the deal with the step’s text, owner and due date, in the current stage, and links it', async () => {
    const co = await company('Minutes Task Co');
    const d = await deal('Minutes deal', co.id);
    const m = await meeting(co.id, { dealId: d.id });
    const withOwner = step({ text: 'Send the pilot contract', ownerUserId: bo.userId, dueDate: '2026-12-01' });
    const noOwner = step({ text: 'Book the follow-up' });
    const saved = (await save(ana, m.id, { nextSteps: [withOwner, noOwner] })).body;

    const created = await ok('POST', `/crm/meetings/${m.id}/minutes/next-steps/${withOwner.id}/task`, as(ana));
    expect(created.task).toMatchObject({
      dealId: d.id,
      stageId: (await ok('GET', `/crm/deals/${d.id}`, as(owner))).stageId,
      label: 'Send the pilot contract',
      channel: 'MT',
      assigneeUserId: bo.userId,
      dueDate: '2026-12-01',
      blocksAdvance: false,
      offPlaybook: true,
      done: false,
    });
    expect(created.minutes.nextSteps.map((s: Json) => s.taskId)).toEqual([created.task.id, null]);
    expect(created.minutes.updatedAt > saved.updatedAt).toBe(true);

    // In the task list (the Today screen reads it), and "Task added" on the deal's timeline.
    const tasks = await ok('GET', `/crm/deal-tasks?dealIds=${d.id}`, as(bo));
    expect(tasks.find((t: Json) => t.id === created.task.id)).toMatchObject({ assigneeUserId: bo.userId, assigneeName: bo.name, dueDate: '2026-12-01' });
    const timeline = await ok('GET', `/crm/deals/${d.id}/activities`, as(owner));
    expect(timeline.find((a: Json) => a.title === 'Task added: Send the pilot contract')?.detail).toBe(`Due 2026-12-01 · Owner ${bo.name}`);

    // Without an owner the caller gets it; without a due date it has none.
    const second = await ok('POST', `/crm/meetings/${m.id}/minutes/next-steps/${noOwner.id}/task`, as(ana));
    expect(second.task).toMatchObject({ assigneeUserId: ana.userId, dueDate: null, label: 'Book the follow-up' });

    // Once only; a later save keeps the link, whatever the browser sends.
    expect((await call('POST', `/crm/meetings/${m.id}/minutes/next-steps/${withOwner.id}/task`, as(ana))).status).toBe(409);
    const resaved = await save(ana, m.id, { nextSteps: [{ ...withOwner, text: 'Send the pilot contract today', taskId: null }, noOwner] });
    expect(resaved.body.nextSteps.map((s: Json) => s.taskId)).toEqual([created.task.id, second.task.id]);

    // A deleted task can be created again.
    await ok('DELETE', `/crm/deal-tasks/${second.task.id}`, as(owner));
    const again = await ok('POST', `/crm/meetings/${m.id}/minutes/next-steps/${noOwner.id}/task`, as(ana));
    expect(again.task.id).not.toBe(second.task.id);

    // Same permission as writing; unknown steps are 404.
    expect((await call('POST', `/crm/meetings/${m.id}/minutes/next-steps/${withOwner.id}/task`, as(bo))).status).toBe(403);
    expect((await call('POST', `/crm/meetings/${m.id}/minutes/next-steps/${randomUUID()}/task`, as(ana))).status).toBe(404);
  });

  it('refuses without a deal, and for an empty step', async () => {
    const co = await company('Minutes No Deal Co');
    const m = await meeting(co.id);
    const s = step();
    await save(ana, m.id, { nextSteps: [s, step({ id: randomUUID(), text: '' })] });
    const res = await call('POST', `/crm/meetings/${m.id}/minutes/next-steps/${s.id}/task`, as(ana));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Link a deal/);

    const d = await deal('Minutes empty step deal', co.id);
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { dealId: d.id } });
    const empty = (await ok('GET', minutesUrl(m.id), as(ana))).nextSteps[1];
    expect((await call('POST', `/crm/meetings/${m.id}/minutes/next-steps/${empty.id}/task`, as(ana))).status).toBe(400);
  });
});

describe('the missingMinutes filter and history', () => {
  it('lists held meetings without a summary only', async () => {
    const co = await company('Minutes Filter Co');
    const heldEmpty = await meeting(co.id, { title: 'Held, no minutes' });
    const heldAgreements = await meeting(co.id, { title: 'Held, agreements only' });
    const heldWritten = await meeting(co.id, { title: 'Held, with minutes' });
    await meeting(co.id, { title: 'Planned, no minutes' });
    for (const m of [heldEmpty, heldAgreements, heldWritten]) await ok('POST', `/crm/meetings/${m.id}/held`, as(owner), 200);
    await save(owner, heldAgreements.id, { agreements: 'Only agreements' });
    await save(owner, heldWritten.id, { summary: 'Summary' });

    const res = await ok('GET', `/crm/meetings?companyId=${co.id}&missingMinutes=1`, as(owner));
    expect(res.meetings.map((m: Json) => m.title).sort()).toEqual(['Held, agreements only', 'Held, no minutes']);
    expect(res.meetings.every((m: Json) => m.internalMinutes === 'missing')).toBe(true);
    const all = await ok('GET', `/crm/meetings?companyId=${co.id}&status=held`, as(owner));
    expect(all.meetings.find((m: Json) => m.id === heldWritten.id).internalMinutes).toBe('recorded');
  });

  it('records changes of the minutes in the meeting’s history', async () => {
    const co = await company('Minutes History Co');
    const m = await meeting(co.id);
    const s = step();
    await save(ana, m.id, { summary: 'First', nextSteps: [s] });
    await save(owner, m.id, { summary: 'Second', agreements: 'Deal' });
    const { entries } = await ok('GET', `/crm/history?entityType=meeting&entityId=${m.id}`, as(bo));
    const of = (field: string) => entries.filter((e: Json) => e.action === 'updated' && e.field === field);
    expect(of('summary').map((e: Json) => [e.oldValue, e.newValue, e.actor?.name])).toEqual([
      ['First', 'Second', owner.name],
      [null, 'First', ana.name],
    ]);
    expect(of('agreements')[0]).toMatchObject({ oldValue: null, newValue: 'Deal' });
    expect(of('nextSteps')[0].newValue).toEqual([{ ...s, taskId: null }]);
  });
});

describe('daily digest', () => {
  it('lists the organizer’s held meetings of the last 7 days without a summary as "Minutes missing"', async () => {
    const co = await company('Minutes Digest Co');
    const missing = await meeting(co.id, { title: 'Needs minutes' }, 2 * DAY);
    const written = await meeting(co.id, { title: 'Has minutes' }, 2 * DAY);
    const old = await meeting(co.id, { title: 'Too old' }, 8 * DAY);
    const planned = await meeting(co.id, { title: 'Still planned' }, 2 * DAY);
    for (const m of [missing, written, old]) await ok('POST', `/crm/meetings/${m.id}/held`, as(owner), 200);
    await save(owner, written.id, { summary: 'Done' });

    const digest = await ok('GET', '/notifications/digest', as(owner));
    const ids = digest.minutesMissing.map((m: Json) => m.id);
    expect(ids).toContain(missing.id);
    expect(ids).not.toContain(written.id);
    expect(ids).not.toContain(old.id);
    expect(ids).not.toContain(planned.id);
    expect(digest.minutesMissing.find((m: Json) => m.id === missing.id)).toMatchObject({ title: 'Needs minutes', company: 'Minutes Digest Co', status: 'held' });
    // Only the organizer's digest: ana takes part but doesn't organize.
    expect((await ok('GET', '/notifications/digest', as(ana))).minutesMissing.map((m: Json) => m.id)).not.toContain(missing.id);
  });
});
