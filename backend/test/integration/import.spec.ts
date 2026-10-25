/**
 * CSV import (CD-64): roles, per-row validation, duplicates (skip / update), deals with company,
 * funnel, stage, owner and contact matching, size and row limits, tenant isolation and CSV quoting.
 */
import { Client } from 'pg';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { addMember, call, createTenant, type Funnel, type Json, ok, READY_IDENTITY, readyCompany, type Session, signIn, testPib, testPibs } from './helpers';
import { asTenantSql } from './people-helpers';

let owner: Session;
let admin: Session;
let member: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
let funnels: Funnel[];
const as = (s: Session = owner) => ({ token: s.token, tenant });

/** A unique suffix, so names never collide with earlier runs' rows in the same workspace. */
let n = 0;
const uniq = (label: string) => `${label} ${Date.now().toString(36)}${++n}`;

const preview = (type: string, body: Json, s: Session = owner) => ok('POST', `/crm/import/${type}/preview`, { ...as(s), body }, 200);
const commit = (type: string, body: Json, s: Session = owner) => ok('POST', `/crm/import/${type}/commit`, { ...as(s), body }, 200);
const companiesNamed = async (name: string, t = tenant, s = owner) =>
  (await ok<Json[]>('GET', `/crm/companies?q=${encodeURIComponent(name)}&limit=200`, { token: s.token, tenant: t })).filter((c) => c.name.toLowerCase() === name.toLowerCase());
const contactsMatching = async (q: string, t = tenant, s = owner) => ok<Json[]>('GET', `/crm/contacts?q=${encodeURIComponent(q)}&limit=200`, { token: s.token, tenant: t });
const dealsMatching = async (q: string) => ok<Json[]>('GET', `/crm/deals?q=${encodeURIComponent(q)}&limit=200`, as());

beforeAll(async () => {
  [owner, admin, member, outsider] = await Promise.all([signIn('import-owner'), signIn('import-admin'), signIn('import-member'), signIn('import-outsider')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Import'), createTenant(outsider, 'Import other')]);
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
  funnels = await ok<Funnel[]>('GET', '/crm/funnels', as());
  expect(funnels.length).toBeGreaterThan(1);
});

describe('who can import', () => {
  it('owners and admins; members get 403 on every import route, outsiders too', async () => {
    const csv = `Name,PIB\n${uniq('Role check')},${testPib()}\n`;
    for (const s of [member]) {
      expect((await call('POST', '/crm/import/companies/preview', { ...as(s), body: { csv } })).status).toBe(403);
      expect((await call('POST', '/crm/import/companies/commit', { ...as(s), body: { csv } })).status).toBe(403);
      expect((await call('GET', '/crm/import/companies/template', as(s))).status).toBe(403);
    }
    expect((await call('POST', '/crm/import/companies/preview', { token: outsider.token, tenant, body: { csv } })).status).toBe(403);
    expect((await preview('companies', { csv }, admin)).counts.create).toBe(1);
    expect((await commit('companies', { csv }, admin)).created).toBe(1);
  });

  it('rejects an unknown type', async () => {
    expect((await call('POST', '/crm/import/invoices/preview', { ...as(), body: { csv: 'Name\nx\n' } })).status).toBe(400);
  });
});

describe('templates', () => {
  it('serves a CSV with a BOM and the field labels for each type', async () => {
    for (const [type, header] of [
      ['companies', 'Name,Company ID (PIB),MB,Industry,HQ'],
      ['contacts', 'Full name,Email'],
      ['deals', 'Opportunity,Company,Company ID (PIB),Funnel,Stage,Value,Closing date'],
      ['products', 'Name,Description,Unit price,Unit,Quantity,Tax %,Billing frequency,Billing cycles'],
    ] as const) {
      const res = await fetch(`${inject('apiUrl')}/api/crm/import/${type}/template`, { headers: { authorization: `Bearer ${owner.token}`, 'x-tenant-id': tenant } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
      expect(res.headers.get('content-disposition')).toContain(`pultly-${type}-template.csv`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(bytes.slice(3))).toContain(header);
    }
  });
});

describe('preview', () => {
  it('guesses the mapping, validates every row with the create rules, and writes nothing', async () => {
    const good = uniq('Preview Good');
    const csv = [
      'Company name,Website,Employees,Owner,Notes,PIB',
      `${good},good.example,11–50,${admin.email},,${testPib()}`,
      `,nobody.example,,,,${testPib()}`,
      `${'x'.repeat(201)},,,,,${testPib()}`,
      `${uniq('Preview Bad owner')},,,someone-else@example.test,,${testPib()}`,
    ].join('\n');
    const res = await preview('companies', { csv });
    expect(res.mapping).toMatchObject({ name: 0, domain: 1, teamSize: 2, ownerEmail: 3, notes: 4, pib: 5, industry: null });
    expect(res.headers).toEqual(['Company name', 'Website', 'Employees', 'Owner', 'Notes', 'PIB']);
    expect(res.counts).toMatchObject({ rows: 4, create: 1, invalid: 3, update: 0, skip: 0 });
    expect(res.rows.map((r: Json) => [r.line, r.status])).toEqual([
      [2, 'create'],
      [3, 'invalid'],
      [4, 'invalid'],
      [5, 'invalid'],
    ]);
    expect(res.rows[0].values).toMatchObject({ name: good, domain: 'good.example', ownerEmail: admin.email });
    expect(res.rows[1].messages).toEqual(['Name is required']);
    expect(res.rows[2].messages[0]).toMatch(/^Name: .*200/);
    expect(res.rows[3].messages).toEqual(['Owner email: no member of this workspace has the email someone-else@example.test']);
    expect(res.problems.map((p: Json) => p.line)).toEqual([3, 4, 5]);
    expect(await companiesNamed(good)).toHaveLength(0);
  });

  it("imports a contact's details and personal details, with a dd.mm.yyyy birthday and no role (CD-361)", async () => {
    const email = `details-${Date.now()}@example.test`;
    const csv = `Full name,Email,Org unit,Source,Influence,Birthday,Spouse,Children,Pets
Dina Details,${email},Procurement,Referral,Signs off,12.04.1985,Marko,Ana (7),Dog Rex
`;
    const result = await commit('contacts', { csv });
    expect(result.problems ?? []).toEqual([]);
    const saved = (await ok<Json[]>('GET', '/crm/contacts', as())).find((c) => c.email === email);
    expect(saved).toMatchObject({ orgUnit: 'Procurement', source: 'Referral', influence: 'Signs off', birthday: '1985-04-12', spouseName: 'Marko', children: 'Ana (7)', pets: 'Dog Rex', buyerRole: null });
  });

  it('refuses a contact row whose phone is not a phone number, and says why (CD-464)', async () => {
    const contacts = await preview('contacts', { csv: `Full name,Phone
Pia,abc123!!
Rea,+381 60 123 4567
` });
    expect(contacts.rows.map((r: Json) => r.messages)).toEqual([[expect.stringMatching(/^Phone: Enter a phone number/)], []]);
  });

  it('reports contact and deal field errors with the field names', async () => {
    const contacts = await preview('contacts', { csv: `Full name,Email,Buyer role\nAna,not-an-email,Champion\nBo,bo@example.test,Boss\nCy,,decision MAKER\n` });
    expect(contacts.rows.map((r: Json) => r.messages)).toEqual([['Email: Invalid email address'], [expect.stringMatching(/^Buyer role: /)], []]);

    // Only an opportunity or a client takes an opportunity (CD-360): the rows name a ready company.
    const [name, acme] = [uniq('Acme'), testPib()];
    await readyCompany(owner, tenant, name, { pib: acme });
    const deals = await preview('deals', {
      csv: `Deal,Company,Stage,Value,Closing date,Funnel,Company ID (PIB)\nA,${name},No such stage,100,2026-01-01,,${acme}\nB,${name},,lots,31.12.2026,,${acme}\nC,${name},,1.000,2026-13-45,,${acme}\nD,,,,,,\nE,${name},,,,Nope,${acme}\n`,
    });
    const messages = deals.rows.map((r: Json) => r.messages);
    expect(messages[0]).toEqual([`Stage: "${(funnels[0] as Json).label}" has no stage named "No such stage"`]);
    expect(messages[1]).toEqual(['Value: Invalid amount']);
    expect(messages[2]).toEqual([expect.stringMatching(/^Closing date: /)]);
    expect(messages[3]).toEqual(['Company is required']);
    expect(messages[4]).toEqual(['Funnel: there is no funnel named "Nope"']);
  });

  it('says Opportunity is required when a row has no title', async () => {
    const [name, pib] = [uniq('Acme'), testPib()];
    await readyCompany(owner, tenant, name, { pib });
    // The old "Deal" header still maps; the message comes from the field label.
    const res = await preview('deals', { csv: `Deal,Company,Company ID (PIB)\n,${name},${pib}\n` });
    expect(res.mapping.title).toBe(0);
    expect(res.rows[0].status).toBe('invalid');
    expect(res.rows[0].messages).toEqual(['Opportunity is required']);
  });

  it('lists required fields without a column', async () => {
    const res = await preview('deals', { csv: 'Something\nx\n' });
    expect(res.missingRequired).toEqual(['Opportunity', 'Company']);
    expect((await call('POST', '/crm/import/deals/commit', { ...as(), body: { csv: 'Something\nx\n' } })).status).toBe(400);
  });

  it('rejects a mapping to a column that does not exist, or to an unknown field', async () => {
    expect((await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: 'Name\nx\n', mapping: { name: 3 } } })).status).toBe(400);
    expect((await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: 'Name\nx\n', mapping: { name: 0, nope: 0 } } })).status).toBe(400);
  });
});

describe('importing companies', () => {
  it('creates valid rows, reports failed rows with line and reason, and uses the mapping sent', async () => {
    const a = uniq('Import A');
    const b = uniq('Import B');
    const [pa, pBad, pb] = testPibs(3);
    const csv = `Kolona,Grana,Vlasnik,Broj\n${a},Retail,${admin.email},${pa}\n,Energy,,${pBad}\n${b},,,${pb}\n`;
    const res = await commit('companies', { csv, mapping: { name: 0, industry: 1, ownerEmail: 2, pib: 3 } });
    expect(res).toMatchObject({ created: 2, updated: 0, skipped: 0, failed: 1, headers: ['Kolona', 'Grana', 'Vlasnik', 'Broj'] });
    expect(res.failures).toEqual([{ line: 3, reason: 'Name is required', cells: ['', 'Energy', '', pBad] }]);
    const [ca] = await companiesNamed(a);
    expect(ca).toMatchObject({ industry: 'Retail', ownerUserId: admin.userId });
    // Without an owner column, the importer owns the rows (as with "Add company").
    expect((await companiesNamed(b))[0]).toMatchObject({ ownerUserId: owner.userId, industry: null });
  });

  it('duplicates by PIB (the Company ID, CD-357): skipped by default, also within the file', async () => {
    const name = uniq('Dup Co');
    const [taken, fresh] = testPibs(2);
    await ok('POST', '/crm/companies', { ...as(), body: { pib: taken, name, industry: 'Old' } });
    const other = uniq('Fresh Co');
    // The first row has another spelling of the name: the PIB decides.
    const csv = `Name,PIB,Industry\n${name.toUpperCase()},${taken},New\n${other},${fresh},One\n${other} again,${fresh},Two\n`;
    const pre = await preview('companies', { csv });
    expect(pre.counts).toMatchObject({ create: 1, skip: 2 });
    const res = await commit('companies', { csv });
    expect(res).toMatchObject({ created: 1, skipped: 2, updated: 0, failed: 0 });
    expect(res.skippedRows).toEqual([
      { line: 2, reason: `A company with the PIB ${taken} already exists` },
      { line: 4, reason: `A company with the PIB ${fresh} already exists` },
    ]);
    expect((await companiesNamed(name)).map((c) => c.industry)).toEqual(['Old']);
    expect((await companiesNamed(other)).map((c) => c.industry)).toEqual(['One']);
  });

  it('updates duplicates when asked, only with the values the row has', async () => {
    const name = uniq('Upd Co');
    const pib = testPib();
    await ok('POST', '/crm/companies', { ...as(), body: { pib, name, industry: 'Old', hq: 'Belgrade', domain: 'old.example' } });
    const csv = `Name,PIB,Industry,HQ,Domain,City\n${name.toLowerCase()},${pib},New,,new.example,Novi Sad\n${name},${pib},,,,\n`;
    const pre = await preview('companies', { csv, duplicates: 'update' });
    expect(pre.rows.map((r: Json) => r.status)).toEqual(['update', 'skip']);
    const res = await commit('companies', { csv, duplicates: 'update' });
    expect(res).toMatchObject({ created: 0, updated: 1, skipped: 1, failed: 0 });
    const [c] = await companiesNamed(name);
    expect(c).toMatchObject({ name, pib, industry: 'New', hq: 'Belgrade', domain: 'new.example', city: 'Novi Sad' });
  });

  it('PIB is required and checked; identity columns are imported', async () => {
    const [good, , clash] = testPibs(3);
    const name = uniq('Ident Co');
    const csv = [
      'Name,PIB,MB,Activity code,Ownership,Street,Postal code',
      `${name},${good},20084693,6201,State,Bulevar 10,21000`,
      `${uniq('No PIB')},,,,,,`,
      `${uniq('Bad PIB')},104052136,,,,,`,
      `${uniq('Bad rest')},${clash},20084694,62,Mixed,,`,
    ].join('\n');
    const res = await preview('companies', { csv });
    expect(res.rows.map((r: Json) => r.status)).toEqual(['create', 'invalid', 'invalid', 'invalid']);
    expect(res.rows[1].messages).toEqual(['Company ID (PIB) is required']);
    expect(res.rows[2].messages).toEqual(['Company ID (PIB): PIB is 9 digits with a valid check digit']);
    expect(res.rows[3].messages).toEqual([
      'Ownership: "Mixed" is not Private or State',
      'MB: MB is 8 digits with a valid check digit',
      'Activity code: The activity code is 4 digits',
    ]);
    await commit('companies', { csv });
    expect((await companiesNamed(name))[0]).toMatchObject({ pib: good, mb: '20084693', activityCode: '6201', ownershipType: 'state', address: 'Bulevar 10', postalCode: '21000' });
  });

  it('an older company without a PIB is matched by name and gets it; a PIB that belongs to another company is refused', async () => {
    const legacy = uniq('Legacy Co');
    const holder = uniq('Holder Co');
    const [legacyPib, holderPib] = testPibs(2);
    await asTenantSql(tenant, `insert into companies (tenant_id, name) values ($1, $2)`, [tenant, legacy]);
    await ok('POST', '/crm/companies', { ...as(), body: { pib: holderPib, name: holder } });
    const res = await commit('companies', { csv: `Name,PIB\n${legacy},${holderPib}\n${legacy},${legacyPib}\n`, duplicates: 'update' });
    expect(res).toMatchObject({ created: 0, updated: 1, failed: 1 });
    expect(res.failures[0]).toMatchObject({ line: 2, reason: `Company ID (PIB): ${holderPib} belongs to another company than the one named "${legacy}"` });
    expect((await companiesNamed(legacy)).map((c) => c.pib)).toEqual([legacyPib]);
  });
});

describe('a batch the database refuses (CD-78)', () => {
  it('is redone row by row: only the refused row fails, the others are saved once', async () => {
    // A trigger (added as the table owner, for this test only) refuses one company by name, which
    // the in-memory checks can't foresee, so the batch's multi-row insert fails.
    const refused = uniq('Refused by trigger');
    const [a, b] = [uniq('Retry A'), uniq('Retry B')];
    const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await admin.connect();
    const fn = `test_refuse_${Date.now().toString(36)}`;
    try {
      await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.name = '${refused}' THEN RAISE EXCEPTION 'Refused by the test trigger'; END IF; RETURN NEW; END $$`);
      await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON companies FOR EACH ROW EXECUTE FUNCTION ${fn}()`);

      const [pa, pRefused, pb] = testPibs(3);
      const res = await commit('companies', { csv: `Name,Industry,PIB\n${a},Retail,${pa}\n${refused},Energy,${pRefused}\n${b},Media,${pb}\n` });
      expect(res).toMatchObject({ created: 2, failed: 1, skipped: 0, updated: 0 });
      expect(res.failures).toHaveLength(1);
      expect(res.failures[0]).toMatchObject({ line: 3, cells: [refused, 'Energy', pRefused] });
      expect(await companiesNamed(a)).toHaveLength(1);
      expect(await companiesNamed(b)).toHaveLength(1);
      expect(await companiesNamed(refused)).toHaveLength(0);
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON companies`);
      await admin.query(`DROP FUNCTION IF EXISTS ${fn}()`);
      await admin.end();
    }
  });
});

describe('importing contacts', () => {
  it('matches duplicates by email (case-insensitive), links or creates the company', async () => {
    const email = `${uniq('dup').replace(/\W/g, '')}@example.test`;
    const company = uniq('Contact Co');
    await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Existing Person', email, jobTitle: 'Old title' } });
    const newEmail = `${uniq('new').replace(/\W/g, '')}@example.test`;
    const pib = testPib();
    const csv = `Name,E-mail,Title,Company,Company ID (PIB),Buyer role\nRenamed,${email.toUpperCase()},New title,${company},${pib},\nNew Person,${newEmail},CTO,${company.toLowerCase()},${pib},champion\nNo Email,,,,,\n`;

    const skip = await commit('contacts', { csv });
    expect(skip).toMatchObject({ created: 2, skipped: 1, updated: 0, failed: 0, newCompanies: 1 });
    const [existing] = await contactsMatching(email);
    expect(existing).toMatchObject({ fullName: 'Existing Person', jobTitle: 'Old title', companyId: null });
    const [created] = await contactsMatching(newEmail);
    expect(created).toMatchObject({ fullName: 'New Person', jobTitle: 'CTO', buyerRole: 'Champion' });
    const [co] = await companiesNamed(company);
    expect(created.companyId).toBe(co.id);
    expect(co.pib).toBe(pib);

    const update = await commit('contacts', { csv: csv.split('\n').slice(0, 2).join('\n'), duplicates: 'update' });
    expect(update).toMatchObject({ created: 0, updated: 1, newCompanies: 0 });
    expect((await contactsMatching(email))[0]).toMatchObject({ fullName: 'Renamed', jobTitle: 'New title', companyId: co.id });
  });
});

describe('importing deals', () => {
  it('matches the company, funnel, stage, owner and contact, and records history', async () => {
    const [first, second] = funnels as [Funnel, Funnel];
    const existingCo = uniq('Deal Existing Co');
    const co = await readyCompany(owner, tenant, existingCo);
    const contactEmail = `${uniq('dealc').replace(/\W/g, '')}@example.test`;
    const contact = await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Deal Contact', email: contactEmail } });
    // Only a company of the workspace that is an opportunity or a client (CD-360); found by its PIB.
    const otherPib = testPib();
    const newCo = uniq('Deal Other Co');
    const other = await readyCompany(owner, tenant, newCo, { pib: otherPib });
    const tag = uniq('DealRow').replace(/\W/g, '');
    const stage = second.stages[2]!;
    const won = first.stages[first.stages.length - 1]!;
    const csv = [
      'Deal,Company,Funnel,Stage,Value,Closing date,Owner email,Contact,Contact email,Source,Company ID (PIB)',
      `${tag} one,${existingCo.toUpperCase()},,,"14,000.50",31.12.2026,${admin.email},,${contactEmail.toUpperCase()},Referral,`,
      `${tag} two,${newCo},${(second as Json).label.toUpperCase()},${stage.name.toLowerCase()},900,,,New Buyer,new-${contactEmail},,${otherPib}`,
      `${tag} three,${newCo},,${won.name},1000,2026-01-15,,,,,`,
    ].join('\n');
    const res = await commit('deals', { csv, funnelId: first.id });
    expect(res).toMatchObject({ created: 3, failed: 0, newCompanies: 0, newContacts: 1 });

    const rows = await dealsMatching(tag);
    const byTitle = Object.fromEntries(rows.map((r: Json) => [r.deal.title, r]));
    expect(byTitle[`${tag} one`].deal).toMatchObject({ companyId: co.id, funnelId: first.id, stageId: first.stages[0]!.id, amount: '14000.50', closeDate: '2026-12-31', ownerUserId: admin.userId, primaryContactId: contact.id, source: 'Referral', outcome: 'open' });
    const two = byTitle[`${tag} two`];
    expect(two.deal).toMatchObject({ funnelId: second.id, stageId: stage.id, amount: '900.00', ownerUserId: owner.userId, closeDate: null });
    expect(two.companyName).toBe(newCo);
    expect(two.contactName).toBe('New Buyer');
    expect(two.deal.companyId).toBe(other.id);
    expect(byTitle[`${tag} three`].deal.companyId).toBe(other.id);
    expect(byTitle[`${tag} three`].deal).toMatchObject({ stageId: won.id, outcome: 'won' });

    const history = await ok<Json[]>('GET', `/crm/deal-stage-history?dealId=${two.deal.id}`, as());
    expect(history.map((h) => [h.kind, h.fromStageId, h.toStageId, h.outcome, h.changedByUserId])).toEqual([['created', null, stage.id, 'open', owner.userId]]);
    const activities = await ok<Json[]>('GET', `/crm/deals/${two.deal.id}/activities`, as());
    expect(activities.map((a) => [a.title, a.detail])).toEqual([['Opportunity created', 'Imported from CSV']]);
  });

  it('gives imported deals the workspace currency, like the create endpoint', async () => {
    const usd = await createTenant(owner, 'Import USD');
    await ok('PATCH', '/workspace', { token: owner.token, tenant: usd, body: { currency: 'USD' } });
    const [funnel] = await ok<Funnel[]>('GET', '/crm/funnels', { token: owner.token, tenant: usd });
    const tag = uniq('UsdRow').replace(/\W/g, '');
    const [usdCo, pib] = [uniq('Usd Co'), testPib()];
    await readyCompany(owner, usd, usdCo, { pib });
    const res = await ok('POST', '/crm/import/deals/commit', { token: owner.token, tenant: usd, body: { csv: `Deal,Company,Value,Company ID (PIB)\n${tag},${usdCo},500,${pib}`, funnelId: funnel!.id } }, 200);
    expect(res).toMatchObject({ created: 1, failed: 0 });
    const [row] = await ok<Json[]>('GET', `/crm/deals?q=${tag}`, { token: owner.token, tenant: usd });
    expect(row.deal.currency).toBe('USD');
  });

  it("doesn't match a removed stage", async () => {
    const f = await ok<Json>('POST', '/crm/funnels', { ...as(), body: { label: uniq('Import removed stage') } });
    const gone = uniq('Gone stage');
    const withStage = await ok<Json>('POST', `/crm/funnels/${f.id}/stages`, { ...as(), body: { name: gone } });
    const stage = withStage.stages.find((st: Json) => st.name === gone);
    await ok('DELETE', `/crm/funnels/${f.id}/stages/${stage.id}`, as(), 200);
    const tag = uniq('GoneRow').replace(/\W/g, '');
    const res = await commit('deals', { csv: `Deal,Company,Stage\n${tag},${uniq('Gone Co')},${gone}`, funnelId: f.id });
    expect(res).toMatchObject({ created: 0, failed: 1 });
  });

  it('fails a row whose contact email is unknown and no name is given', async () => {
    const [nobody, pib] = [uniq('Nobody Co'), testPib()];
    await readyCompany(owner, tenant, nobody, { pib });
    const res = await commit('deals', { csv: `Deal,Company,Company ID (PIB),Contact email\nX,${nobody},${pib},nobody-${Date.now()}@example.test\n` });
    expect(res).toMatchObject({ created: 0, failed: 1, newCompanies: 0 });
    expect(res.failures[0].reason).toMatch(/^Contact email: no contact has the email /);
  });

  it('a company the workspace lacks is refused, and needs its PIB (CD-357, CD-360); a PIB finds a company under another name, spaces ignored', async () => {
    const unknown = uniq('Unknown Co');
    const tag = uniq('PibRow').replace(/\W/g, '');
    const missing = await commit('deals', { csv: `Deal,Company\n${tag} lost,${unknown}\n` });
    expect(missing).toMatchObject({ created: 0, failed: 1, newCompanies: 0 });
    expect(missing.failures[0].reason).toBe(`Company: no company named "${unknown}"; add its Company ID (PIB) to create it`);
    expect(await companiesNamed(unknown)).toHaveLength(0);

    const bad = await commit('deals', { csv: `Deal,Company,Company ID (PIB)\n${tag} bad,${unknown},123\n` });
    expect(bad.failures[0].reason).toMatch(/^Company ID \(PIB\): /);

    const pib = testPib();
    const spaced = `${pib.slice(0, 3)} ${pib.slice(3, 6)} ${pib.slice(6)}`;
    // With its PIB it is still not created: a new company would be a lead (CD-360).
    const made = await commit('deals', { csv: `Deal,Company,Company ID (PIB)\n${tag} new,${unknown},${spaced}\n` });
    expect(made).toMatchObject({ created: 0, failed: 1, newCompanies: 0 });
    expect(made.failures[0].reason).toBe(`Company: "${unknown}" isn't in this workspace yet; add it and complete it first (only an opportunity or a client can enter the Pipeline)`);
    expect(await companiesNamed(unknown)).toHaveLength(0);

    const co = await readyCompany(owner, tenant, unknown, { pib });
    const found = await commit('deals', { csv: `Deal,Company,Company ID (PIB)\n${tag} found,Some other spelling,${spaced}\n` });
    expect(found).toMatchObject({ created: 1, failed: 0, newCompanies: 0 });
    expect((await dealsMatching(`${tag} found`))[0].deal.companyId).toBe(co.id);

    // The PIB wins over the name: a row spelling the company differently still finds it.
    const contact = await commit('contacts', { csv: `Full name,Company,Company ID (PIB)\nPia ${tag},Another spelling,${pib}\n` });
    expect(contact).toMatchObject({ created: 1, failed: 0, newCompanies: 0 });
    const [pia] = await contactsMatching(`Pia ${tag}`);
    expect(pia.companyId).toBe(co.id);
  });
});

describe('importing products (CD-81)', () => {
  const productsNamed = async (name: string) => (await ok<Json[]>('GET', `/crm/products?q=${encodeURIComponent(name)}&limit=200`, as())).filter((p) => p.name.toLowerCase() === name.toLowerCase());

  it('creates products with price, unit, tax and billing, and reports bad rows', async () => {
    const a = uniq('Setup');
    const b = uniq('Retainer');
    const c = uniq('Licence');
    const d = uniq('Broken');
    const csv = [
      'Name,Description,Unit price,Unit,Quantity,Tax %,Billing frequency,Billing cycles',
      `${a},One-off setup,"1.500,50",project,1,20%,One time,`,
      `${b},,900,month,1,20,Monthly,6`,
      `${c},,120,seat,10,0,yearly,`,
      `${d},,10,,,,Fortnightly,`,
      `${uniq('Cycles')},,10,,,,,4`,
    ].join('\n');
    const pre = await preview('products', { csv });
    expect(pre.counts).toMatchObject({ create: 3, invalid: 2 });
    const res = await commit('products', { csv });
    expect(res).toMatchObject({ created: 3, failed: 2 });
    expect(res.failures.map((f: Json) => f.reason)).toEqual([
      'Billing frequency: "Fortnightly" is not One time, Weekly, Monthly, Quarterly or Annually',
      'Billing cycles: only recurring products (weekly, monthly, quarterly or annually) have billing cycles',
    ]);
    expect((await productsNamed(a))[0]).toMatchObject({ description: 'One-off setup', unitPrice: '1500.50', unit: 'project', vatRate: '20.00', billingFrequency: 'one_time', billingCycles: null });
    expect((await productsNamed(b))[0]).toMatchObject({ unitPrice: '900.00', billingFrequency: 'monthly', billingCycles: 6 });
    // Recurring without cycles renews until canceled.
    expect((await productsNamed(c))[0]).toMatchObject({ quantity: '10.00', vatRate: '0.00', billingFrequency: 'annually', billingCycles: null });
  });

  it('matches existing products by name: skipped by default, updated when asked', async () => {
    const name = uniq('Audit');
    await ok('POST', '/crm/products', { ...as(), body: { name, unitPrice: 100 } });
    const csv = `Name,Unit price\n${name.toUpperCase()},250\n`;
    expect(await commit('products', { csv })).toMatchObject({ created: 0, skipped: 1 });
    expect(Number((await productsNamed(name))[0].unitPrice)).toBe(100);
    expect(await commit('products', { csv, duplicates: 'update' })).toMatchObject({ updated: 1 });
    const found = await productsNamed(name);
    expect(found).toHaveLength(1);
    expect(Number(found[0].unitPrice)).toBe(250);
  });

  it('updating billing: a frequency sets the cycles too, and cycles alone keep the frequency', async () => {
    const monthly = uniq('Support');
    const other = uniq('Hosting');
    await ok('POST', '/crm/products', { ...as(), body: { name: monthly, unitPrice: 100, billingFrequency: 'monthly', billingCycles: 12 } });
    await ok('POST', '/crm/products', { ...as(), body: { name: other, unitPrice: 50, billingFrequency: 'monthly', billingCycles: 12 } });
    // Switching to one time drops the cycles; Monthly with an empty cell renews until canceled.
    const switched = `Name,Billing frequency,Billing cycles\n${monthly},One time,\n${other},Monthly,\n`;
    expect(await commit('products', { csv: switched, duplicates: 'update' })).toMatchObject({ updated: 2, failed: 0 });
    expect((await productsNamed(monthly))[0]).toMatchObject({ billingFrequency: 'one_time', billingCycles: null });
    expect((await productsNamed(other))[0]).toMatchObject({ billingFrequency: 'monthly', billingCycles: null });
    // A file without the frequency column changes the cycles of a recurring product, and rejects them on a one-time one.
    const cyclesOnly = `Name,Billing cycles\n${other},24\n${monthly},3\n`;
    const res = await commit('products', { csv: cyclesOnly, duplicates: 'update' });
    expect(res).toMatchObject({ updated: 1, failed: 1 });
    expect(res.failures.map((f: Json) => f.reason)).toEqual(['Billing cycles: only recurring products (weekly, monthly, quarterly or annually) have billing cycles']);
    expect((await productsNamed(other))[0]).toMatchObject({ billingFrequency: 'monthly', billingCycles: 24 });
  });

  it('members get 403', async () => {
    expect((await call('POST', '/crm/import/products/preview', { ...as(member), body: { csv: 'Name\nx\n' } })).status).toBe(403);
  });
});

describe('limits', () => {
  it('accepts a file above the default 100 kB JSON limit', async () => {
    const prefix = uniq('Big');
    const pibs = testPibs(1500);
    const rows = Array.from({ length: 1500 }, (_, i) => `${prefix} ${i},${'Industry text '.repeat(6)},${pibs[i]}`);
    const csv = `Name,Industry,PIB\n${rows.join('\n')}\n`;
    expect(csv.length).toBeGreaterThan(100_000);
    expect((await preview('companies', { csv })).counts).toMatchObject({ rows: 1500, create: 1500 });
  });

  it('refuses more than 5,000 rows and files over 2 MB', async () => {
    const tooMany = `Name\n${Array.from({ length: 5001 }, (_, i) => `R${i}`).join('\n')}\n`;
    const rows = await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: tooMany } });
    expect(rows.status).toBe(400);
    expect(rows.body.message).toBe('The file has 5,001 rows; the limit is 5,000. Split it into smaller files.');
    expect((await call('POST', '/crm/import/companies/commit', { ...as(), body: { csv: tooMany } })).status).toBe(400);

    const big = `Name,Notes\n${Array.from({ length: 100 }, (_, i) => `R${i},${'n'.repeat(22_000)}`).join('\n')}\n`;
    const tooBig = await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: big } });
    expect(tooBig.status).toBe(413);
    // A body beyond the route's parser limit is refused before it reaches the service.
    const huge = await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: 'x'.repeat(3_200_000) } });
    expect(huge.status).toBe(413);
    // Other routes keep the default limit.
    expect((await call('POST', '/crm/companies', { ...as(), body: { pib: testPib(), name: 'x', notes: 'y'.repeat(200_000) } })).status).toBe(413);
  });

  it('refuses an empty file and a file with only a header', async () => {
    expect((await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: '' } })).status).toBe(400);
    const header = await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: 'Name\n\n' } });
    expect(header.status).toBe(400);
    expect(header.body.message).toBe('The file has a header row but no data rows');
  });
});

describe('tenant isolation', () => {
  it("an import neither matches nor changes another workspace's rows", async () => {
    const name = uniq('Shared Name');
    const email = `${uniq('shared').replace(/\W/g, '')}@example.test`;
    // The same name and the same PIB in another workspace: neither matches here.
    const sharedPib = testPib();
    const theirs = await ok('POST', '/crm/companies', { token: outsider.token, tenant: otherTenant, body: { pib: sharedPib, name, industry: 'Theirs' } });
    await ok('POST', '/crm/contacts', { token: outsider.token, tenant: otherTenant, body: { fullName: 'Their Person', email } });

    const companies = await commit('companies', { csv: `Name,PIB,Industry\n${name},${sharedPib},Ours\n`, duplicates: 'update' });
    expect(companies).toMatchObject({ created: 1, updated: 0 });
    const contacts = await commit('contacts', { csv: `Name,Email\nOur Person,${email}\n`, duplicates: 'update' });
    expect(contacts).toMatchObject({ created: 1, updated: 0 });
    // Ours is completed, so it can take an opportunity (CD-360).
    const [imported] = await companiesNamed(name);
    await ok('PATCH', `/crm/companies/${imported.id}`, { ...as(), body: READY_IDENTITY });
    await ok('POST', '/crm/contacts', { ...as(), body: { companyId: imported.id, fullName: 'Petar Nikolić', jobTitle: 'CEO', buyerRole: 'Decision maker', ownerUserId: owner.userId } });
    const deals = await commit('deals', { csv: `Deal,Company,Contact email\nIsolated ${name},${name},${email}\n` });
    expect(deals).toMatchObject({ created: 1, newCompanies: 0, newContacts: 0 });

    // Theirs is untouched and ours are separate rows.
    expect(await companiesNamed(name, otherTenant, outsider)).toEqual([expect.objectContaining({ id: theirs.id, industry: 'Theirs' })]);
    expect((await contactsMatching(email, otherTenant, outsider)).map((c) => c.fullName)).toEqual(['Their Person']);
    const ours = await companiesNamed(name);
    expect(ours.map((c) => c.industry)).toEqual(['Ours']);
    expect(ours[0].id).not.toBe(theirs.id);
    const [deal] = await dealsMatching(`Isolated ${name}`);
    expect(deal.deal.companyId).toBe(ours[0].id);
    expect(deal.contactName).toBe('Our Person');
  });

  it("refuses another workspace's funnel and owners who aren't members here", async () => {
    const theirFunnels = await ok<Funnel[]>('GET', '/crm/funnels', { token: outsider.token, tenant: otherTenant });
    const res = await call('POST', '/crm/import/deals/preview', { ...as(), body: { csv: 'Deal,Company\nX,Y\n', funnelId: theirFunnels[0]!.id } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown funnel');
    const owners = await preview('companies', { csv: `Name,Owner email,PIB\n${uniq('Owner check')},${outsider.email},${testPib()}\n` });
    expect(owners.rows[0].messages).toEqual([`Owner email: no member of this workspace has the email ${outsider.email}`]);
  });
});

describe('CSV quoting', () => {
  it('reads semicolons, quoted delimiters, doubled quotes, line breaks in quotes, a BOM and CRLF', async () => {
    const a = uniq('Quote; "Co", Ltd');
    const b = uniq('Plain');
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const [pa, pb] = testPibs(2);
    const csv = `\uFEFFName;Notes;Industry;PIB\r\n${cell(a)};"Line one\r\nline two, with a comma";Retail;${pa}\r\n${b};;"=SUM(A1)";${pb}\r\n`;
    const res = await commit('companies', { csv });
    expect(res).toMatchObject({ created: 2, failed: 0 });
    expect((await companiesNamed(a))[0]).toMatchObject({ name: a, notes: 'Line one\nline two, with a comma', industry: 'Retail' });
    // Stored as text: the formula guard belongs to the export.
    expect((await companiesNamed(b))[0]).toMatchObject({ industry: '=SUM(A1)', notes: null });
  });

  it("drops the export's formula guard so an exported file imports back unchanged", async () => {
    const name = uniq('Guarded');
    await commit('companies', { csv: `Name,Industry,Notes,PIB\n${name},'=HYPERLINK(1),'-5 and 'quoted',${testPib()}\n` });
    expect((await companiesNamed(name))[0]).toMatchObject({ industry: '=HYPERLINK(1)', notes: "-5 and 'quoted'" });
  });

  it('refuses a file with an unterminated quote', async () => {
    const res = await call('POST', '/crm/import/companies/preview', { ...as(), body: { csv: 'Name\n"Open\nNever closed\n' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`The file can't be read as CSV. Line 2: a quoted field is never closed (missing ")`);
  });
});
