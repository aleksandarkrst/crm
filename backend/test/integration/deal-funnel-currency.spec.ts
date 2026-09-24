/**
 * A funnel change is written on the deal's timeline (CD-74), and new deals take the workspace
 * currency unless they are given their own (CD-73).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
let smb: Funnel & { label: string; stages: { id: string; name: string; activity: string }[] };
let ent: typeof smb;
const as = () => ({ token: owner.token, tenant });

interface Activity {
  title: string;
  detail: string | null;
  channel: string;
}
const activitiesOf = (dealId: string) => ok<Activity[]>('GET', `/crm/deals/${dealId}/activities`, as());

beforeAll(async () => {
  owner = await signIn('funnel-currency');
  tenant = await createTenant(owner, 'Funnel Currency');
  const funnels = await ok<(typeof smb)[]>('GET', '/crm/funnels', as());
  smb = funnels.find((f) => f.key === 'smb')!;
  ent = funnels.find((f) => f.key === 'ent')!;
});

describe('funnel change on the timeline', () => {
  it('logs "Moved to funnel …" with the stage the deal restarts at', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Switcher', funnelId: smb.id } });
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { funnelId: ent.id } });
    const [latest] = await activitiesOf(deal.id);
    expect(latest).toMatchObject({ title: `Moved to funnel ${ent.label}`, channel: 'NT' });
    expect(latest!.detail).toContain(`Restarted at ${ent.stages[0]!.name}`);
  });

  it('logs nothing when the funnel stays the same or the change is refused', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Stayer', funnelId: smb.id } });
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { funnelId: smb.id, title: 'Stayer again' } });
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Timing' } }, 200);
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { funnelId: ent.id } })).status).toBe(409);
    const titles = (await activitiesOf(deal.id)).map((a) => a.title);
    expect(titles.filter((t) => t.startsWith('Moved to funnel'))).toEqual([]);
  });
});

describe('deal currency', () => {
  it('new deals take the workspace currency', async () => {
    const before = await ok('POST', '/crm/deals', { ...as(), body: { title: 'In euros', funnelId: smb.id } });
    expect(before.currency).toBe('EUR');
    await ok('PATCH', '/workspace', { ...as(), body: { currency: 'USD' } });
    const after = await ok('POST', '/crm/deals', { ...as(), body: { title: 'In dollars', funnelId: smb.id } });
    expect(after.currency).toBe('USD');
    // Existing deals keep their own currency.
    expect((await ok('GET', `/crm/deals/${before.id}`, as())).currency).toBe('EUR');
  });

  it('a deal can be given its own currency, which must be an ISO 4217 code', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'In pounds', funnelId: smb.id, currency: 'gbp' } });
    expect(deal.currency).toBe('GBP');
    expect((await call('POST', '/crm/deals', { ...as(), body: { title: 'Bad', funnelId: smb.id, currency: 'XYZ' } })).status).toBe(400);
  });
});
