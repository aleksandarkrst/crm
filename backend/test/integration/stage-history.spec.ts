/**
 * Stage history (CD-61): a row for every stage change (creation, moves, funnel changes), written
 * with the change, and isolated per tenant like every other CRM table.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let alice: Session;
let bob: Session;
let tenantA: string;
let tenantB: string;
let smb: Funnel;
let ent: Funnel;
const asA = () => ({ token: alice.token, tenant: tenantA });
const asB = () => ({ token: bob.token, tenant: tenantB });

interface HistoryRow {
  id: string;
  dealId: string;
  kind: string;
  fromStageId: string | null;
  toStageId: string;
  outcome: string;
  changedAt: string;
  changedByUserId: string | null;
}
const historyOf = async (dealId: string, as = asA()) => ok<HistoryRow[]>('GET', `/crm/deal-stage-history?dealId=${dealId}`, as);

beforeAll(async () => {
  [alice, bob] = await Promise.all([signIn('history-alice'), signIn('history-bob')]);
  [tenantA, tenantB] = await Promise.all([createTenant(alice, 'History A'), createTenant(bob, 'History B')]);
  const funnels = await ok<(Funnel & { stages: { id: string; isWon: boolean }[] })[]>('GET', '/crm/funnels', asA());
  smb = funnels.find((f) => f.key === 'smb')!;
  ent = funnels.find((f) => f.key === 'ent')!;
});

describe('stage history rows', () => {
  it('records the first stage when a deal is created', async () => {
    const deal = await ok('POST', '/crm/deals', { ...asA(), body: { title: 'Created', funnelId: smb.id } });
    const rows = await historyOf(deal.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dealId: deal.id, kind: 'created', fromStageId: null, toStageId: smb.stages[0]!.id, outcome: 'open', changedByUserId: alice.userId });
    expect(rows[0]!.changedAt).toBe(deal.createdAt);
  });

  it('records moves (drag and drop), including into the won stage, and ignores a move to the same stage', async () => {
    const deal = await ok('POST', '/crm/deals', { ...asA(), body: { title: 'Moved', funnelId: smb.id } });
    const [s0, s1, s2] = smb.stages;
    const won = smb.stages[smb.stages.length - 1]!;
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...asA(), body: { stageId: s2!.id } }, 200);
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...asA(), body: { stageId: s1!.id } }, 200);
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...asA(), body: { stageId: s1!.id } }, 200); // no change
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...asA(), body: { stageId: won.id } }, 200);
    const rows = await historyOf(deal.id);
    expect(rows.map((r) => [r.kind, r.fromStageId, r.toStageId, r.outcome])).toEqual([
      ['created', null, s0!.id, 'open'],
      ['moved', s0!.id, s2!.id, 'open'],
      ['moved', s2!.id, s1!.id, 'open'],
      ['moved', s1!.id, won.id, 'won'],
    ]);
    const after = await ok('GET', `/crm/deals/${deal.id}`, asA());
    expect(after.stageEnteredAt).toBe(rows[3]!.changedAt);
  });

  it("records a funnel change as a move to the new funnel's first stage", async () => {
    const deal = await ok('POST', '/crm/deals', { ...asA(), body: { title: 'Switched', funnelId: smb.id } });
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...asA(), body: { stageId: smb.stages[2]!.id } }, 200);
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asA(), body: { funnelId: ent.id } });
    // Re-sending the same funnel changes nothing.
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asA(), body: { funnelId: ent.id, title: 'Switched again' } });
    const rows = await historyOf(deal.id);
    expect(rows.map((r) => [r.kind, r.fromStageId, r.toStageId])).toEqual([
      ['created', null, smb.stages[0]!.id],
      ['moved', smb.stages[0]!.id, smb.stages[2]!.id],
      ['funnel_changed', smb.stages[2]!.id, ent.stages[0]!.id],
    ]);
  });

  it('writes nothing when the move fails', async () => {
    const deal = await ok('POST', '/crm/deals', { ...asA(), body: { title: 'Wrong funnel', funnelId: smb.id } });
    const res = await call('POST', `/crm/deals/${deal.id}/move`, { ...asA(), body: { stageId: ent.stages[1]!.id } });
    expect(res.status).toBe(400);
    expect(await historyOf(deal.id)).toHaveLength(1);
  });

  it('lists the whole workspace, paged, oldest first', async () => {
    const all = await ok<HistoryRow[]>('GET', '/crm/deal-stage-history?limit=200', asA());
    expect(all.length).toBe(9); // the four deals above: 1 + 4 + 3 + 1 rows
    const stamps = all.map((r) => r.changedAt);
    expect([...stamps].sort()).toEqual(stamps);
    const page = await ok<HistoryRow[]>('GET', '/crm/deal-stage-history?limit=2&offset=1', asA());
    expect(page.map((r) => r.id)).toEqual(all.slice(1, 3).map((r) => r.id));
    expect((await call('GET', '/crm/deal-stage-history?limit=500', asA())).status).toBe(400);
  });

  it('deleting a deal deletes its history', async () => {
    const deal = await ok('POST', '/crm/deals', { ...asA(), body: { title: 'Deleted', funnelId: smb.id } });
    await ok('DELETE', `/crm/deals/${deal.id}`, asA());
    expect(await historyOf(deal.id)).toEqual([]);
  });
});

describe('stage history isolation', () => {
  let dealA: string;
  let db: Client;

  beforeAll(async () => {
    dealA = (await ok('POST', '/crm/deals', { ...asA(), body: { title: 'Alpha history', funnelId: smb.id } })).id;
    await ok('POST', `/crm/deals/${dealA}/move`, { ...asA(), body: { stageId: smb.stages[1]!.id } }, 200);
    db = new Client({ connectionString: inject('databaseUrl') });
    await db.connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  async function asTenant<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    await db.query('begin');
    try {
      if (tenantId) await db.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn();
    } finally {
      await db.query('rollback');
    }
  }
  const sqlError = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (err: { code?: string }) => err.code,
    );

  it("tenant B's API sees none of tenant A's history, and a non-member gets 403", async () => {
    expect(await ok('GET', '/crm/deal-stage-history', asB())).toEqual([]);
    expect(await historyOf(dealA, asB())).toEqual([]);
    expect((await call('GET', '/crm/deal-stage-history', { token: bob.token, tenant: tenantA })).status).toBe(403);
  });

  it('in SQL, the runtime role sees no history without a tenant, and none of tenant A as tenant B', async () => {
    await asTenant(null, async () => {
      const { rows } = await db.query(`select count(*)::int as n from deal_stage_history`);
      expect(rows[0].n).toBe(0);
    });
    await asTenant(tenantB, async () => {
      const { rows } = await db.query(`select count(*)::int as n from deal_stage_history where tenant_id = $1 or deal_id = $2`, [tenantA, dealA]);
      expect(rows[0].n).toBe(0);
      expect((await db.query(`delete from deal_stage_history where deal_id = $1`, [dealA])).rowCount).toBe(0);
    });
    await asTenant(tenantA, async () => {
      const { rows } = await db.query(`select count(*)::int as n from deal_stage_history where deal_id = $1`, [dealA]);
      expect(rows[0].n).toBe(2);
    });
  });

  it("rejects history rows in another tenant (RLS) or pointing at another tenant's deal (composite FK)", async () => {
    const stageA = smb.stages[0]!.id;
    const planted = await asTenant(tenantB, () =>
      sqlError(db.query(`insert into deal_stage_history (tenant_id, deal_id, kind, to_stage_id, outcome) values ($1, $2, 'moved', $3, 'open')`, [tenantA, dealA, stageA])),
    );
    expect(planted).toBe('42501');
    const funnelsB = await ok<Funnel[]>('GET', '/crm/funnels', asB());
    const crossRef = await asTenant(tenantB, () =>
      sqlError(db.query(`insert into deal_stage_history (tenant_id, deal_id, kind, to_stage_id, outcome) values ($1, $2, 'moved', $3, 'open')`, [tenantB, dealA, funnelsB[0]!.stages[0]!.id])),
    );
    expect(crossRef).toBe('23503');
  });
});
