/**
 * The company status backfill (CD-358, drizzle/0123_company_status_backfill.sql) gives every existing
 * company what computeStatus gives a new one: it restates the rules in SQL, so this runs the shipped
 * statements on seeded companies (one per rule) and compares each status with computeStatus for the
 * same facts. It runs as the owner in one transaction that is rolled back, so nothing it does stays.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeStatus, type OpportunityState, type ProjectState } from '../../src/modules/crm/companies/company-status';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { createTenant, type Funnel, ok, type Session, signIn, testPib } from './helpers';

const identity = { mb: '20084693', activityCode: '4941', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' };
const statements = readFileSync(join(__dirname, '../../drizzle/0123_company_status_backfill.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);
// The file lifts FORCE RLS, runs its UPDATE, and puts FORCE back; the rollback puts it back here.
const lift = statements.filter((s) => /NO FORCE ROW LEVEL SECURITY/.test(s));
const update = statements.filter((s) => s.startsWith('UPDATE'));

let owner: Session;
let other: Session;
const ids: Record<string, string> = {};
let db: Client;

beforeAll(async () => {
  [owner, other] = await Promise.all([signIn('backfill-owner'), signIn('backfill-other')]);
  const tenant = await createTenant(owner, 'Backfill');
  const otherTenant = await createTenant(other, 'Backfill other');
  const as = { token: owner.token, tenant };
  const funnel = (await ok<Funnel[]>('GET', '/crm/funnels', as))[0]!;
  const won = funnel.stages.find((s) => s.isWon)!;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as);
  const company = async (key: string, extra: Record<string, unknown> = {}, s = as) => (ids[key] = (await ok<{ id: string }>('POST', '/crm/companies', { ...s, body: { name: key, pib: testPib(), ...extra } })).id);
  const deal = (companyId: string, s = as, funnelId = funnel.id) => ok<{ id: string }>('POST', '/crm/deals', { ...s, body: { title: 'Deal', companyId, funnelId } });
  const project = (companyId: string) => ok<{ id: string }>('POST', '/projects', { ...as, body: { name: 'Project', projectTypeId: type!.id, companyId } });
  const qualified = (companyId: string, buyerRole: string | null = 'Champion', s = as, by = owner) =>
    ok('POST', '/crm/contacts', { ...s, body: { companyId, fullName: 'Jelena Savić', jobTitle: 'Head of operations', buyerRole, ownerUserId: by.userId } });
  // Only an opportunity or a client takes an opportunity (CD-360).
  const ready = async (key: string, s = as, by = owner) => {
    const id = await company(key, identity, s);
    await qualified(id, 'Champion', s, by);
    return id;
  };

  await ok('POST', `/crm/deals/${(await deal(await ready('won deal'))).id}/move`, { ...as, body: { stageId: won.id } }, 200);
  await project(await company('open project'));
  const past = await project(await company('only completed projects'));
  await ok('PATCH', `/projects/${past.id}`, { ...as, body: { status: 'completed' } });
  const mixed = await ready('completed project and an open deal');
  await ok('PATCH', `/projects/${(await project(mixed)).id}`, { ...as, body: { status: 'completed' } });
  await deal(mixed);
  await ok('POST', `/crm/deals/${(await deal(await ready('all deals lost'))).id}/lost`, { ...as, body: { reason: 'Price' } }, 200);
  await qualified(await company('ready', identity));
  await qualified(await company('whitespace PIB', identity));
  await qualified(await company('contact without a role in the decision', identity), null);
  await company('nothing yet');
  // Another workspace: its facts stay its own.
  const theirs = await ready('other workspace won deal', { token: other.token, tenant: otherTenant }, other);
  const otherFunnel = (await ok<Funnel[]>('GET', '/crm/funnels', { token: other.token, tenant: otherTenant }))[0]!;
  const otherDeal = await deal(theirs, { token: other.token, tenant: otherTenant }, otherFunnel.id);
  await ok('POST', `/crm/deals/${otherDeal.id}/move`, { token: other.token, tenant: otherTenant, body: { stageId: otherFunnel.stages.find((s) => s.isWon)!.id } }, 200);

  db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

describe('the 0123 backfill', () => {
  it('gives each company the status computeStatus gives it, and changes nothing else', async () => {
    const seeded = Object.values(ids);
    // What the file holds: FORCE lifted on the five tables it reads, and its one UPDATE.
    expect(lift).toHaveLength(5);
    expect(update).toHaveLength(1);
    await db.query('begin');
    try {
      for (const s of lift) await db.query(s);
      // As before the migration: every company a lead, one with a PIB that is only spaces.
      await db.query(`update companies set status = 'lead', status_changed_at = null where id = any($1)`, [seeded]);
      await db.query(`update companies set pib = '   ' where id = $1`, [ids['whitespace PIB']]);
      const before = (await db.query(`select * from companies where id = any($1)`, [seeded])).rows;
      for (const s of update) await db.query(s);
      const after = (await db.query(`select * from companies where id = any($1)`, [seeded])).rows;

      const contacts = (await db.query(`select company_id, full_name, job_title, buyer_role, owner_user_id from contacts where company_id = any($1)`, [seeded])).rows;
      const deals = (await db.query(`select d.company_id, d.lost_at, s.is_won from deals d join funnel_stages s on s.id = d.stage_id where d.company_id = any($1)`, [seeded])).rows;
      const projects = (await db.query(`select company_id, status from projects where company_id = any($1)`, [seeded])).rows;
      const expected = Object.fromEntries(
        before.map((c) => [
          c.id,
          computeStatus({
            company: { name: c.name, pib: c.pib, mb: c.mb, address: c.address, city: c.city, postalCode: c.postal_code, activityCode: c.activity_code },
            contacts: contacts.filter((p) => p.company_id === c.id).map((p) => ({ fullName: p.full_name, jobTitle: p.job_title, buyerRole: p.buyer_role, ownerUserId: p.owner_user_id })),
            opportunities: deals.filter((d) => d.company_id === c.id).map((d): OpportunityState => (d.lost_at ? 'lost' : d.is_won ? 'won' : 'open')),
            projects: projects.filter((p) => p.company_id === c.id).map((p) => p.status as ProjectState),
          }),
        ]),
      );
      const byName = (rows: typeof after) => Object.fromEntries(rows.map((c) => [c.name, c.status]));
      expect(byName(after)).toEqual({
        'won deal': 'client',
        'open project': 'client',
        'only completed projects': 'past_client',
        'completed project and an open deal': 'client',
        'all deals lost': 'not_interested',
        ready: 'opportunity',
        'whitespace PIB': 'lead',
        'contact without a role in the decision': 'lead',
        'nothing yet': 'lead',
        'other workspace won deal': 'client',
      });
      for (const c of after) expect(c.status, c.name).toBe(expected[c.id]);

      // Only the status, its time and the row version (the updated_at trigger) move.
      const rest = ({ status: _s, status_changed_at: _t, updated_at: _u, ...row }: Record<string, unknown>) => row;
      const was = new Map(before.map((c) => [c.id, c]));
      for (const c of after) expect(rest(c), c.name).toEqual(rest(was.get(c.id)!));
      for (const c of after) expect(c.status_changed_at === null, c.name).toBe(c.status === 'lead');
    } finally {
      await db.query('rollback');
    }
  });
});
