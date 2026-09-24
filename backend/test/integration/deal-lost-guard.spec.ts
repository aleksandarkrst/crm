/**
 * CD-74: the database itself keeps lost deals out of the won stage (triggers in
 * drizzle/0010_deal_lost_not_won.sql), whatever code writes the rows. Tested in SQL as the runtime
 * role, the way the API connects, bypassing DealsService's own checks.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
let smb: Funnel & { stages: { id: string; isWon: boolean }[] };
let db: Client;
const as = () => ({ token: owner.token, tenant });
const wonStage = () => smb.stages.find((s) => s.isWon)!;

beforeAll(async () => {
  owner = await signIn('guard-owner');
  tenant = await createTenant(owner, 'Lost guard');
  smb = (await ok('GET', '/crm/funnels', as())).find((f: Funnel) => f.key === 'smb');
  db = new Client({ connectionString: inject('databaseUrl') });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

/** Runs `fn` in a transaction as this tenant (like DatabaseService.withTenant), then rolls back. */
async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    return await fn();
  } finally {
    await db.query('rollback');
  }
}
const sqlError = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (err: { code?: string; constraint?: string }) => `${err.code} ${err.constraint}`,
  );
const newDeal = async (title: string) => (await ok('POST', '/crm/deals', { ...as(), body: { title, funnelId: smb.id } })).id as string;

describe('a lost deal in the won stage', () => {
  it('is refused when a deal in the won stage is marked lost in SQL', async () => {
    const id = await newDeal('Won, then lost in SQL');
    await ok('POST', `/crm/deals/${id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    const err = await inTenant(() => sqlError(db.query(`update deals set lost_at = now(), lost_reason = 'Price' where id = $1`, [id])));
    expect(err).toBe('23514 deals_lost_not_won');
  });

  it('is refused when a lost deal is moved into the won stage in SQL', async () => {
    const id = await newDeal('Lost, then won in SQL');
    await ok('POST', `/crm/deals/${id}/lost`, { ...as(), body: { reason: 'Timing' } }, 200);
    const err = await inTenant(() => sqlError(db.query(`update deals set stage_id = $2 where id = $1`, [id, wonStage().id])));
    expect(err).toBe('23514 deals_lost_not_won');
  });

  it('is refused when a lost deal is inserted straight into the won stage', async () => {
    const err = await inTenant(() =>
      sqlError(
        db.query(`insert into deals (tenant_id, funnel_id, stage_id, title, lost_at, lost_reason) values ($1, $2, $3, 'Born lost and won', now(), 'Other')`, [
          tenant,
          smb.id,
          wonStage().id,
        ]),
      ),
    );
    expect(err).toBe('23514 deals_lost_not_won');
  });

  it('is refused when a stage holding lost deals becomes the won stage', async () => {
    const id = await newDeal('Lost in negotiation');
    const stage = smb.stages[4]!;
    await ok('POST', `/crm/deals/${id}/move`, { ...as(), body: { stageId: stage.id } }, 200);
    await ok('POST', `/crm/deals/${id}/lost`, { ...as(), body: { reason: 'Price' } }, 200);
    const err = await inTenant(() => sqlError(db.query(`update funnel_stages set is_won = true where id = $1`, [stage.id])));
    expect(err).toBe('23514 deals_lost_not_won');
  });

  it('still allows what the service does: lost outside the won stage, reopened, then won', async () => {
    const id = await newDeal('Normal life');
    await ok('POST', `/crm/deals/${id}/lost`, { ...as(), body: { reason: 'Timing' } }, 200);
    await ok('POST', `/crm/deals/${id}/reopen`, as(), 200);
    expect((await ok('POST', `/crm/deals/${id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200)).outcome).toBe('won');
    // Other columns of a lost deal can still change in SQL.
    const other = await newDeal('Lost, renamed');
    await ok('POST', `/crm/deals/${other}/lost`, { ...as(), body: { reason: 'Other' } }, 200);
    const err = await inTenant(() => sqlError(db.query(`update deals set title = 'Renamed' where id = $1`, [other])));
    expect(err).toBeNull();
  });

  it('the API still answers 409 for these cases (service check first)', async () => {
    const id = await newDeal('API won');
    await ok('POST', `/crm/deals/${id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    expect((await call('POST', `/crm/deals/${id}/lost`, { ...as(), body: { reason: 'Price' } })).status).toBe(409);
  });
});
