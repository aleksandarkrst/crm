/**
 * Live updates (CD-20): GET /api/events streams change hints of the caller's workspace, and never
 * another workspace's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { addMember, call, createTenant, firstFunnel, ok, type Session, signIn } from './helpers';

interface ChangeEvent {
  type: string;
  op?: string;
  ids?: string[] | null;
  dealIds?: string[] | null;
  client?: string | null;
}

/** An open event stream that collects the change events it receives. */
async function openStream(s: Session, tenant: string) {
  const abort = new AbortController();
  const res = await fetch(`${inject('apiUrl')}/api/events`, { headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': tenant }, signal: abort.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
  const events: ChangeEvent[] = [];
  let ready = false;
  let buffer = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (type === 'ready') ready = true;
          if (type === 'change' && data) events.push(JSON.parse(data) as ChangeEvent);
        }
      }
    } catch {
      // aborted
    }
  })();
  const waitFor = async (predicate: (e: ChangeEvent) => boolean, ms = 5_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No matching event within ${ms} ms; got ${JSON.stringify(events)}`);
  };
  const deadline = Date.now() + 5_000;
  while (!ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  expect(ready).toBe(true);
  return { events, waitFor, close: () => abort.abort() };
}

let owner: Session;
let member: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
const streams: { close: () => void }[] = [];

beforeAll(async () => {
  owner = await signIn('events-owner');
  member = await signIn('events-member');
  outsider = await signIn('events-outsider');
  tenant = await createTenant(owner, 'Events');
  otherTenant = await createTenant(outsider, 'Events other');
  await addMember(owner, tenant, member, 'member');
});
afterAll(() => streams.forEach((s) => s.close()));

describe('event stream', () => {
  it("delivers the workspace's changes to its members, with the tab that made them", async () => {
    const mine = await openStream(member, tenant);
    streams.push(mine);
    const funnel = await firstFunnel(owner, tenant);
    const deal = await ok('POST', '/crm/deals', { token: owner.token, tenant, body: { title: 'Live deal', funnelId: funnel.id } });
    await mine.waitFor((e) => e.type === 'deal' && e.op === 'insert' && !!e.ids?.includes(deal.id));

    await ok('PATCH', `/crm/deals/${deal.id}`, { token: owner.token, tenant, headers: { 'x-client-id': 'tab-events-owner' }, body: { title: 'Live deal 2' } });
    const update = await mine.waitFor((e) => e.type === 'deal' && e.op === 'update');
    expect(update).toMatchObject({ ids: [deal.id], client: 'tab-events-owner' });

    const company = await ok('POST', '/crm/companies', { token: owner.token, tenant, body: { name: 'Live Co' } });
    await mine.waitFor((e) => e.type === 'company' && !!e.ids?.includes(company.id));
    const task = await ok('POST', `/crm/deals/${deal.id}/tasks`, { token: owner.token, tenant, body: { stageId: funnel.stages[0]!.id, label: 'Call', blocksAdvance: false } });
    await mine.waitFor((e) => e.type === 'task' && !!e.ids?.includes(task.id) && !!e.dealIds?.includes(deal.id));
    await ok('DELETE', `/crm/deals/${deal.id}`, { token: owner.token, tenant });
    await mine.waitFor((e) => e.type === 'deal' && e.op === 'delete' && !!e.ids?.includes(deal.id));
  });

  it("never delivers another workspace's changes", async () => {
    const theirs = await openStream(outsider, otherTenant);
    streams.push(theirs);
    const mine = await openStream(owner, tenant);
    streams.push(mine);

    const secret = await ok('POST', '/crm/companies', { token: owner.token, tenant, body: { name: 'Secret Co' } });
    await mine.waitFor((e) => !!e.ids?.includes(secret.id));
    // A change in the other workspace arrives there, which proves its stream is live...
    const own = await ok('POST', '/crm/companies', { token: outsider.token, tenant: otherTenant, body: { name: 'Their Co' } });
    await theirs.waitFor((e) => !!e.ids?.includes(own.id));
    // ...and nothing of the first workspace ever did.
    expect(theirs.events.some((e) => e.ids?.includes(secret.id))).toBe(false);
    expect(mine.events.some((e) => e.ids?.includes(own.id))).toBe(false);
  });

  it('renamed projects and tasks reach every member at once (CD-143)', async () => {
    const mine = await openStream(member, tenant);
    streams.push(mine);
    await ok('PATCH', '/workspace', { token: owner.token, tenant, headers: { 'x-client-id': 'tab-terms' }, body: { terms: { project: 'Job', projects: 'Jobs', task: 'Step', tasks: 'Steps' } } });
    expect(await mine.waitFor((e) => e.type === 'workspace')).toMatchObject({ ids: [tenant], client: 'tab-terms' });
  });

  it('requires a signed-in member of the workspace', async () => {
    expect((await call('GET', '/events', { tenant })).status).toBe(401);
    expect((await call('GET', '/events', { token: outsider.token, tenant })).status).toBe(403);
    expect((await call('GET', '/events', { token: owner.token })).status).toBe(403);
  });
});
