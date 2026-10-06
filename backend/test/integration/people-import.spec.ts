/**
 * Employee import (CD-141, spec 8): who may import (Admins since CD-225; 403 for the rest),
 * the template, a WBM-like file with Serbian headers, departments, teams and managers listed after
 * their reports, every error type with its line and field, preview == commit, re-import with Skip
 * and Update, no reporting loops (in the file and with existing employees), a manager whose row
 * fails, "Imported" history, invitations, and 5,000 rows in under 30 seconds.
 */
import { Client } from 'pg';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { call, createTenant, eventually, type Json, mailTo, ok, type Session, signIn } from './helpers';
import { grantRole, joinAsEmployee } from './people-helpers';

let owner: Session;
let wsAdmin: Session;
let hr: Session;
let pay: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

/** Unique per run and call, so emails, numbers and names never collide with earlier rows. */
let n = 0;
const tag = () => `${Date.now().toString(36)}${++n}`;
const mail = (who: string, t: string) => `${who}.${t}@wbm.test`;

const preview = (body: Json, s: Session = owner) => ok('POST', '/people/import/preview', { ...as(s), body }, 200);
const commit = (body: Json, s: Session = owner) => ok('POST', '/people/import/commit', { ...as(s), body }, 200);
/** Every employee (active and inactive) of the workspace, by work email. */
async function employeesByEmail(): Promise<Map<string, Json>> {
  const list = await ok('GET', '/people/employees?status=active,leaving,inactive', as());
  return new Map(list.employees.filter((e: Json) => e.workEmail).map((e: Json) => [e.workEmail, e]));
}

beforeAll(async () => {
  [owner, wsAdmin, hr, pay, member] = (await Promise.all(['pimp-owner', 'pimp-admin', 'pimp-hr', 'pimp-pay', 'pimp-member'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'People import');
  await joinAsEmployee(owner, tenant, wsAdmin, 'admin');
  const hrId = await joinAsEmployee(owner, tenant, hr);
  const payId = await joinAsEmployee(owner, tenant, pay);
  await joinAsEmployee(owner, tenant, member);
  // Rows of the removed Administration and Payroll roles (CD-225) give nothing.
  await grantRole(tenant, hrId, 'administration');
  await grantRole(tenant, payId, 'payroll');
});

describe('who can import', () => {
  it('Admins; members (leftover Administration and Payroll rows included) and outsiders get 403 on every route', async () => {
    const csv = `Ime,Prezime,Email\nRole,Check,${mail('role', tag())}\n`;
    for (const s of [member, pay, hr]) {
      expect((await call('POST', '/people/import/preview', { ...as(s), body: { csv } })).status).toBe(403);
      expect((await call('POST', '/people/import/commit', { ...as(s), body: { csv } })).status).toBe(403);
      expect((await call('GET', '/people/import/template', as(s))).status).toBe(403);
    }
    const outsider = await signIn('pimp-outsider');
    expect((await call('POST', '/people/import/preview', { token: outsider.token, tenant, body: { csv } })).status).toBe(403);
    expect((await preview({ csv }, wsAdmin)).counts.create).toBe(1);
    expect((await commit({ csv }, wsAdmin)).created).toBe(1);
  });

  it('every importer is an Admin, so every importer may ask for invitations', async () => {
    const csv = `Ime,Prezime,Email\nInvite,Check,${mail('inv', tag())}\n`;
    expect((await call('POST', '/people/import/preview', { ...as(hr), body: { csv, invite: true } })).status).toBe(403);
    expect((await preview({ csv }, wsAdmin)).canInvite).toBe(true);
    expect((await preview({ csv }, owner)).canInvite).toBe(true);
  });
});

describe('template', () => {
  it('is a CSV with a BOM, the column labels and an example row', async () => {
    const res = await fetch(`${inject('apiUrl')}/api/people/import/template`, { headers: { authorization: `Bearer ${wsAdmin.token}`, 'x-tenant-id': tenant } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toContain('pultly-employees-template.csv');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, example] = new TextDecoder().decode(bytes.slice(3)).split('\r\n');
    expect(header).toMatch(/^First name,Last name,Work email,Employee number,Job title,Department,Team,Manager email,Employment start date,Employment type,Weekly hours/);
    expect(example).toMatch(/^Ana,Petrović,/);
  });
});

describe('a WBM-like file', () => {
  it('imports departments, teams and managers listed after their reports in one pass; preview == commit', async () => {
    const t = tag();
    const [ana, ivan, marko, jelena] = ['ana', 'ivan', 'marko', 'jelena'].map((w) => mail(w, t)) as [string, string, string, string];
    const csv = [
      'Ime,Prezime,E-mail adresa,Broj zaposlenog,Radno mesto,Sektor,Tim,Nadređeni,Datum zaposlenja,Vrsta ugovora,Sati nedeljno,Tekući račun',
      `Ana,Petrović,${ana},A-${t},Prodavac,Prodaja ${t},Teren BG,${marko},01.03.2024,neodređeno,40,260-0056010016113-79`,
      `Ivan,Ilić,${ivan},B-${t},Prodavac,prodaja ${t},teren bg,${marko},45352,određeno,"37,5",`,
      `Marko,Jović,${marko},C-${t},Direktor prodaje,Prodaja ${t},,${jelena},2020-01-15,,,`,
      `Jelena,Đorđević,${jelena},D-${t},Direktor,Uprava ${t},,,,ugovor o delu,,`,
    ].join('\n');

    const before = (await employeesByEmail()).size;
    const p = await preview({ csv });
    expect((await employeesByEmail()).size).toBe(before);
    expect(p.mapping).toMatchObject({ firstName: 0, lastName: 1, workEmail: 2, employeeNumber: 3, jobTitle: 4, department: 5, team: 6, managerEmail: 7, employmentStartDate: 8, employmentType: 9, weeklyHours: 10, iban: 11 });
    expect(p.counts).toMatchObject({ rows: 4, create: 4, update: 0, skip: 0, invalid: 0, newDepartments: 2, newTeams: 1, warnings: 2 });
    expect(p.newDepartments).toEqual([`Prodaja ${t}`, `Uprava ${t}`]);
    expect(p.newTeams).toEqual([`Prodaja ${t} / Teren BG`]);
    expect(p.rows[0].warnings).toEqual(['IBAN converted from the account number: RS35 2600 0560 1001 6113 79']);
    expect(p.rows[3].warnings).toEqual(['Employment start date missing']);

    const res = await commit({ csv });
    expect(res).toMatchObject({ created: 4, updated: 0, skipped: 0, failed: 0, invitationsQueued: 0, withoutManager: [] });
    expect(res.newDepartments.sort()).toEqual([`Prodaja ${t}`, `Uprava ${t}`]);
    expect(res.newTeams).toEqual([`Prodaja ${t} / Teren BG`]);

    const all = await employeesByEmail();
    const [a, i, m, j] = [ana, ivan, marko, jelena].map((e) => all.get(e));
    expect(a).toMatchObject({ firstName: 'Ana', lastName: 'Petrović', jobTitle: 'Prodavac', departmentName: `Prodaja ${t}`, teamName: 'Teren BG', managerId: m.id });
    expect(i).toMatchObject({ departmentId: a.departmentId, teamId: a.teamId, managerId: m.id });
    expect(m).toMatchObject({ departmentId: a.departmentId, teamId: null, managerId: j.id });
    expect(j).toMatchObject({ departmentName: `Uprava ${t}`, managerId: null });
    expect(a.employment).toMatchObject({ employeeNumber: `A-${t}`, startDate: '2024-03-01', type: 'permanent', weeklyHours: 40 });
    expect(i.employment).toMatchObject({ startDate: '2024-03-01', type: 'fixed_term', weeklyHours: 37.5 });
    expect(j.employment).toMatchObject({ startDate: null, type: 'contractor' });
    const card = await ok('GET', `/people/employees/${a.id}`, as());
    expect(card.bank.iban).toMatchObject({ last4: '1379', country: 'RS' });

    // History says "Imported", by the importer.
    const history = await ok('GET', `/people/history?entityType=employee&entityId=${a.id}`, as());
    const created = history.entries.find((e: Json) => e.field === null);
    expect(created).toMatchObject({ action: 'imported', label: 'Ana Petrović' });
    expect(created.actor.userId).toBe(owner.userId);
  });

  it('re-importing with Skip creates nothing; with Update it changes only non-empty cells', async () => {
    const t = tag();
    const [ana, ivan] = [mail('ana', t), mail('ivan', t)];
    const first = [`Ime,Prezime,Email,Radno mesto,Telefon,Lokacija,Nadređeni`, `Ana,Petrović,${ana},Prodavac,+381 11 111,Beograd,`, `Ivan,Ilić,${ivan},Magacioner,+381 11 222,Niš,${ana}`].join('\n');
    expect(await commit({ csv: first })).toMatchObject({ created: 2 });
    const count = (await employeesByEmail()).size;

    const skip = await commit({ csv: first });
    expect(skip).toMatchObject({ created: 0, updated: 0, skipped: 2, failed: 0 });
    expect(skip.skippedRows[0].reason).toBe(`An employee with the email ${ana} already exists`);
    expect((await employeesByEmail()).size).toBe(count);

    // Update: a new job title for Ana, empty phone and location cells, and her email in capitals.
    const second = [`Ime,Prezime,Email,Radno mesto,Telefon,Lokacija,Nadređeni`, `Ana,Petrović,${ana.toUpperCase()},Šef prodaje,,,`, `Ivan,Ilić,${ivan},,,,`].join('\n');
    const p = await preview({ csv: second, duplicates: 'update' });
    expect(p.counts).toMatchObject({ update: 2, create: 0 });
    expect(await commit({ csv: second, duplicates: 'update' })).toMatchObject({ created: 0, updated: 2, skipped: 0, failed: 0 });
    const all = await employeesByEmail();
    expect(all.get(ana)).toMatchObject({ jobTitle: 'Šef prodaje', workPhone: '+381 11 111', workLocation: 'Beograd', workEmail: ana });
    expect(all.get(ivan)).toMatchObject({ jobTitle: 'Magacioner', workPhone: '+381 11 222', managerId: all.get(ana).id });
    expect(all.size).toBe(count);
  });

  it('updates an inactive employee without reactivating them', async () => {
    const t = tag();
    const gone = mail('gone', t);
    await commit({ csv: `Ime,Prezime,Email\nGone,Away,${gone}\n` });
    const id = (await employeesByEmail()).get(gone).id;
    await deactivate(id);
    const p = await preview({ csv: `Ime,Prezime,Email,Radno mesto\nGone,Away,${gone},Archivist\n`, duplicates: 'update' });
    expect(p.rows[0].notes).toContain('Inactive: not reactivated');
    expect(await commit({ csv: `Ime,Prezime,Email,Radno mesto\nGone,Away,${gone},Archivist\n`, duplicates: 'update' })).toMatchObject({ updated: 1 });
    expect((await employeesByEmail()).get(gone)).toMatchObject({ jobTitle: 'Archivist', status: 'inactive' });
  });
});

/** Marks an employee as having left (deactivation's API is CD-140's UI lane; SQL as the runtime role). */
async function deactivate(employeeId: string) {
  const db = new Client({ connectionString: inject('databaseUrl') });
  await db.connect();
  try {
    await db.query('begin');
    await db.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    await db.query(`update employees set deactivated_at = now(), employment_end_date = current_date where id = $1`, [employeeId]);
    await db.query('commit');
  } finally {
    await db.end();
  }
}

describe('errors', () => {
  it('reports every error type with its line and field, in the preview and the commit alike', async () => {
    const t = tag();
    const e = (w: string) => mail(w, t);
    const gone = e('gone');
    await commit({ csv: `Ime,Prezime,Email,Broj zaposlenog\nUsed,Number,${e('used')},N-${t}\nGone,Manager,${gone},\n` });
    await deactivate((await employeesByEmail()).get(gone).id);

    const csv = [
      'Ime,Prezime,Ime i prezime,Email,Broj zaposlenog,Nadređeni,Sektor,Tim,Datum zaposlenja,Vrsta ugovora,Sati nedeljno,IBAN',
      `,,Ana,${e('l2')},,,,,,,,`,
      `Ana,,,${e('l3')},,,,,,,,`,
      `Ana,P,,not-an-email,,,,,,,,`,
      `Ana,P,,${e('l5')},,,,,31.02.2024,,,`,
      `Ana,P,,${e('l6')},,,,,,sezonski,,`,
      `Ana,P,,${e('l7')},,,,,,,sixty,`,
      `Ana,P,,${e('l8')},,,,,,,,RS35260005601001611378`,
      `Ana,P,,${e('l8')},,,,,,,,`,
      `Ana,P,,${e('l10')},N-${t},,,,,,,`,
      `Ana,P,,${e('l11')},,,,Tim,,,,`,
      `Ana,P,,${e('l12')},,${e('nobody')},,,,,,`,
      `Ana,P,,${e('l13')},,${e('l13')},,,,,,`,
      `Ana,P,,${e('l14')},,${gone},,,,,,`,
      `Loop,One,,${e('loop1')},,${e('loop2')},,,,,,`,
      `Loop,Two,,${e('loop2')},,${e('loop1')},,,,,,`,
    ].join('\n');
    const expected: Record<number, string> = {
      2: 'Full name: "Ana" needs a first and a last name',
      3: 'Last name is required',
      4: 'Work email: Not a valid email address',
      5: 'Employment start date: "31.02.2024" is not a date (use YYYY-MM-DD or DD.MM.YYYY)',
      6: 'Employment type: "sezonski" is not Permanent, Fixed term, Contractor or Student',
      7: 'Weekly hours: "sixty" is not a number',
      8: 'IBAN: not a valid IBAN or Serbian account number',
      9: 'Same email as line 8',
      10: `Employee number: N-${t} is already used by Used Number`,
      11: 'Team: "Tim" needs a department in the same row',
      12: `Manager not found: ${e('nobody')}`,
      13: "Manager email: an employee can't be their own manager",
      14: 'Manager has left the company',
      15: 'Reporting loop: lines 15 → 16 → 15',
      16: 'Reporting loop: lines 16 → 15 → 16',
    };
    const p = await preview({ csv });
    expect(p.counts).toMatchObject({ rows: 15, invalid: 15, create: 0 });
    expect(Object.fromEntries(p.problems.map((x: Json) => [x.line, x.messages.join(' | ')]))).toEqual(expected);

    const before = (await employeesByEmail()).size;
    const res = await commit({ csv });
    expect(res).toMatchObject({ created: 0, failed: 15 });
    expect(Object.fromEntries(res.failures.map((f: Json) => [f.line, f.reason]))).toEqual(expected);
    expect(res.failures[0].cells).toEqual(['', '', 'Ana', e('l2'), '', '', '', '', '', '', '', '']);
    expect((await employeesByEmail()).size).toBe(before);
  });

  it('refuses a loop with existing employees, and never leaves one', async () => {
    const t = tag();
    const [boss, deputy] = [mail('boss', t), mail('deputy', t)];
    await commit({ csv: `Ime,Prezime,Email,Nadređeni\nBoss,Big,${boss},\nDeputy,Small,${deputy},${boss}\n` });
    const csv = `Ime,Prezime,Email,Nadređeni\nBoss,Big,${boss},${deputy}\n`;
    const p = await preview({ csv, duplicates: 'update' });
    expect(p.problems).toEqual([{ line: 2, messages: ['Reporting loop: line 2 → Deputy Small → line 2'] }]);
    expect(await commit({ csv, duplicates: 'update' })).toMatchObject({ updated: 0, failed: 1 });
    const all = await employeesByEmail();
    expect(all.get(boss).managerId).toBeNull();
    expect(all.get(deputy).managerId).toBe(all.get(boss).id);
  });

  it('saves an employee without a manager when the manager\'s row fails to save', async () => {
    const t = tag();
    const [report, refused] = [mail('report', t), mail('refused', t)];
    // A trigger (added as the table owner, for this test only) refuses the manager's row when it is
    // saved, which the checks can't foresee: the batch is redone row by row and only that row fails.
    const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await admin.connect();
    const fn = `test_refuse_emp_${Date.now().toString(36)}`;
    try {
      await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.work_email = '${refused}' THEN RAISE EXCEPTION 'Refused by the test trigger'; END IF; RETURN NEW; END $$`);
      await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON employees FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      const res = await commit({ csv: `Ime,Prezime,Email,Nadređeni\nRe,Port,${report},${refused}\nRe,Fused,${refused},\n` });
      expect(res).toMatchObject({ created: 1, failed: 1 });
      expect(res.failures[0]).toMatchObject({ line: 3, reason: 'Refused by the test trigger' });
      expect(res.withoutManager).toEqual([{ line: 2, reason: "Imported without manager: the manager's row (line 3) failed" }]);
      const all = await employeesByEmail();
      expect(all.get(report).managerId).toBeNull();
      expect(all.has(refused)).toBe(false);
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON employees`);
      await admin.query(`DROP FUNCTION IF EXISTS ${fn}()`);
      await admin.end();
    }
  });
});

describe('invitations', () => {
  it('invites the new employees with a work email as Members, linked to their record', async () => {
    const t = tag();
    const [a, b] = [mail('inva', t), mail('invb', t)];
    const res = await commit({ csv: `Ime,Prezime,Email\nInv,Ana,${a}\nInv,Bez,\nInv,Boris,${b}\n`, invite: true });
    expect(res).toMatchObject({ created: 3, invitationsQueued: 2 });
    const team = await eventually(async () => {
      const r = await ok('GET', '/team', as());
      return r.invitations.filter((i: Json) => i.email === a || i.email === b).length === 2 ? r : null;
    }, 'the import invitations');
    expect(team.invitations.find((i: Json) => i.email === a)).toMatchObject({ role: 'member' });
    const list = await ok('GET', '/people/employees?account=invited', as());
    expect(list.employees.map((e: Json) => e.workEmail)).toEqual(expect.arrayContaining([a, b]));
    await eventually(async () => (await mailTo(owner, a)).length > 0, `the invitation email to ${a}`);
  });
});

describe('performance', () => {
  it('imports 5,000 rows with departments, teams and managers in under 30 seconds', { timeout: 120_000 }, async () => {
    const t = tag();
    const lines = ['First name,Last name,Work email,Employee number,Department,Team,Manager email,Employment start date'];
    for (let i = 0; i < 5000; i++) {
      // Everyone reports to someone listed later (i + 1 … in blocks of 10), the last row to nobody.
      const manager = i % 10 === 9 || i === 4999 ? (i + 10 < 5000 ? mail(`p${i + 10}`, t) : '') : mail(`p${i - (i % 10) + 9}`, t);
      lines.push(`Person,No${i},${mail(`p${i}`, t)},P${t}-${i},Dept ${i % 10} ${t},Team ${i % 40},${manager},2024-01-${String((i % 28) + 1).padStart(2, '0')}`);
    }
    const csv = lines.join('\n');
    const started = Date.now();
    const res = await commit({ csv });
    const elapsed = Date.now() - started;
    expect(res).toMatchObject({ created: 5000, failed: 0, withoutManager: [] });
    expect(elapsed).toBeLessThan(30_000);
    const all = await employeesByEmail();
    expect(all.get(mail('p0', t)).managerId).toBe(all.get(mail('p9', t)).id);
    expect(all.get(mail('p9', t)).managerId).toBe(all.get(mail('p19', t)).id);
  });
});
