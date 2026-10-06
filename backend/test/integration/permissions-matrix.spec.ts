/**
 * The permission matrix of milestones 12 and 13 (CD-142, spec 9.3, AC 9.7), table-driven from the
 * server's own definition (modules/people/permissions.ts): for every row of the live modules (CRM,
 * Org structure, Settings) and every role (Employee, Manager, Admin; Administration and Payroll
 * were removed by CD-225), an API call checks that the caller may do exactly what the matrix says,
 * for themselves, a direct report, an indirect report and anyone else. Rows whose endpoints come
 * with other issues are `it.todo` until they land. Then: leftover Administration / Payroll rows
 * give nothing and their routes are gone, a workspace role change to admin, and no personal
 * details or IBAN for callers who may not see them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { allows, type PermissionRelation, PERMISSION_MODULES, permissionMatrix, permissionRow } from '../../src/modules/people/permissions';
import type { FunctionalRole } from '../../src/modules/people/caller-access';
import { call, createTenant, firstFunnel, ok, type Session, signIn } from './helpers';
import { asTenantSql, createDepartment, grantRole, IBAN, joinAsEmployee, START } from './people-helpers';

type Caller = 'employee' | 'manager' | 'admin';
/** `legacy` holds leftover Administration and Payroll rows (CD-225 removed the roles). */
type Person = Caller | 'lead' | 'other' | 'legacy';
const CALLERS: Caller[] = ['employee', 'manager', 'admin'];
/** Each caller's functional roles, as PeopleAccess derives them from the fixture below. */
const ROLES: Record<Caller, FunctionalRole[]> = {
  employee: ['employee'],
  manager: ['employee', 'manager'],
  admin: ['employee', 'admin'],
};
/**
 * The org: manager → lead → employee (so the employee is the manager's indirect report). "other"
 * reports to nobody. The admin is the workspace owner.
 */
const RELATED: Record<Caller, Partial<Record<PermissionRelation, Person>>> = {
  employee: { self: 'employee', other: 'other' },
  manager: { self: 'manager', direct: 'lead', indirect: 'employee', other: 'other' },
  admin: { self: 'admin', other: 'other' },
};

const who = {} as Record<Person, Session>;
const emp = {} as Record<Person, string>;
let tenant: string;
let companyId: string;
let dealId: string;
let departmentId: string;
const plans = {} as Record<Person, string>;
const as = (p: Person) => ({ token: who[p].token, tenant });
/** Who `target` is to `caller`. */
const relationOf = (caller: Caller, target: Person): PermissionRelation => (Object.entries(RELATED[caller]).find(([, p]) => p === target)?.[0] as PermissionRelation | undefined) ?? 'other';
const privateEmail = (p: Person) => `priv-${p.replace('+', '-')}@example.test`;
const PLAN_MONTH = '2031-01-01';
const allowedBy = (status: number, yes: number) => {
  expect([yes, 403, 404], `status ${status}`).toContain(status);
  return status === yes;
};

beforeAll(async () => {
  const people: Person[] = [...CALLERS, 'lead', 'other', 'legacy'];
  for (const p of people) who[p] = await signIn(`perm-${p.replace('+', '-')}`);
  tenant = await createTenant(who.admin, 'Permission matrix');
  emp.admin = (await ok('GET', '/people/access', as('admin'))).employeeId;
  for (const p of people.filter((x) => x !== 'admin')) emp[p] = await joinAsEmployee(who.admin, tenant, who[p]);
  // Rows of the removed roles stay in the table (expand/contract) but give nothing.
  await grantRole(tenant, emp.legacy, 'administration');
  await grantRole(tenant, emp.legacy, 'payroll');
  const reportsTo: [Person, Person][] = [
    ['lead', 'manager'],
    ['employee', 'lead'],
  ];
  for (const [p, m] of reportsTo) await ok('PATCH', `/people/employees/${emp[p]}`, { ...as('admin'), body: { managerId: emp[m] } }, 200);
  // Everyone has personal details and a bank account, so the sections and the reveal have something to show.
  for (const p of people) {
    await ok('PATCH', `/people/employees/${emp[p]}`, { ...as('admin'), body: { employmentStartDate: START, privateEmail: privateEmail(p), iban: IBAN } }, 200);
  }
  departmentId = await createDepartment(tenant, 'Sales');
  const funnel = await firstFunnel(who.admin, tenant);
  companyId = (await ok('POST', '/crm/companies', { ...as('admin'), body: { name: 'Matrix Co' } })).id;
  dealId = (await ok('POST', '/crm/deals', { ...as('admin'), body: { title: 'Matrix deal', funnelId: funnel.id, companyId } })).id;
  for (const p of people) {
    const plan = await ok('POST', '/crm/visit-plans', { ...as('admin'), body: { salespersonUserId: who[p].userId, periodStart: PLAN_MONTH, lines: [{ companyId, plannedVisits: 2 }] } });
    plans[p] = plan.id;
  }
}, 180_000);

it('the fixture gives each caller the roles the matrix is tested for', async () => {
  for (const c of CALLERS) expect((await ok('GET', '/people/access', as(c))).roles, c).toEqual(ROLES[c]);
});

it('GET /people/permissions is the definition the server checks against', async () => {
  for (const c of CALLERS) expect(await ok('GET', '/people/permissions', as(c))).toEqual(JSON.parse(JSON.stringify(permissionMatrix())));
});

/** A probe: does `caller` get to do the row's action for `target` (a person of that relation)? */
type Probe = (caller: Caller, target: Person, relation: PermissionRelation) => Promise<boolean>;
interface Case {
  /** Relations to try; the default: every relation the caller has. */
  relations?: PermissionRelation[];
  probe: Probe;
  /** The expected answer when the cell's label adds a condition the generic rule can't express. */
  expect?: (caller: Caller, relation: PermissionRelation) => boolean;
}

const cardOf = (caller: Person, target: Person) => ok('GET', `/people/employees/${emp[target]}`, as(caller));
const meetingFor = async (organizer: Person) =>
  (
    await ok('POST', '/crm/meetings', {
      ...as('admin'),
      body: { title: 'Matrix meeting', type: 'visit', startsAt: '2031-02-10T09:00:00.000Z', endsAt: '2031-02-10T10:00:00.000Z', companyId, dealId, organizerUserId: who[organizer].userId },
    })
  ).id as string;
let monthSeq = 0;
/** A month nobody has a plan for yet. */
const freshMonth = () => {
  monthSeq += 1;
  return `${2040 + Math.floor(monthSeq / 12)}-${String((monthSeq % 12) + 1).padStart(2, '0')}-01`;
};

const CASES: Record<string, Case> = {
  // ---------------------------------------------------------------- CRM (existing and milestone 12)
  'crm.records': {
    relations: ['other'],
    probe: async (c) => {
      const created = await call('POST', '/crm/companies', { ...as(c), body: { name: `Made by ${c}` } });
      if (created.status !== 201) return false;
      return (await call('PATCH', `/crm/companies/${created.body.id}`, { ...as(c), body: { industry: 'Retail' } })).status === 200;
    },
  },
  'crm.admin': {
    relations: ['other'],
    probe: async (c) => {
      const co = await ok('POST', '/crm/companies', { ...as('admin'), body: { name: `Delete me ${c}` } });
      const r = await call('DELETE', `/crm/companies/${co.id}`, as(c));
      if (r.status !== 204) await ok('DELETE', `/crm/companies/${co.id}`, as('admin'));
      return allowedBy(r.status, 204);
    },
  },
  'crm.bonuses': { relations: ['other'], probe: async (c) => allowedBy((await call('GET', '/crm/bonus-rules', as(c))).status, 200) },
  'crm.meetings.change': {
    relations: ['self', 'direct', 'other'],
    probe: async (c, t) => allowedBy((await call('PATCH', `/crm/meetings/${await meetingFor(t)}`, { ...as(c), body: { title: `Changed by ${c}` } })).status, 200),
  },
  'crm.visit_plans.own': {
    relations: ['self'],
    probe: async (c, t) => {
      const one = await call('GET', `/crm/visit-plans/${plans[t]}`, as(c));
      const list = await ok('GET', `/crm/visit-plans?periodStart=${PLAN_MONTH}`, as(c));
      return allowedBy(one.status, 200) && list.plans.some((p: { id: string }) => p.id === plans[t]);
    },
  },
  'crm.visit_plans.see': {
    relations: ['direct', 'indirect', 'other'],
    probe: async (c, t) => {
      const one = await call('GET', `/crm/visit-plans/${plans[t]}`, as(c));
      const listed = (await ok('GET', `/crm/visit-plans?periodStart=${PLAN_MONTH}`, as(c))).plans.some((p: { id: string }) => p.id === plans[t]);
      const progress = (await ok('GET', `/crm/visit-plans/progress?ids=${plans[t]}`, as(c))).progress.length === 1;
      // The report and the Overview summary show the person's row only to those who see their plans.
      const report = await call('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PLAN_MONTH}`, as(c));
      const inReport = report.status === 200 && report.body.rows.some((r: { salespersonUserId: string }) => r.salespersonUserId === who[t].userId);
      const summary = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${PLAN_MONTH}&all=1`, as(c));
      const inSummary = summary.plans.some((p: { salespersonUserId: string }) => p.salespersonUserId === who[t].userId);
      const seen = allowedBy(one.status, 200);
      expect({ listed, progress, inReport, inSummary }, `${c} → ${t}`).toEqual({ listed: seen, progress: seen, inReport: seen, inSummary: seen });
      return seen;
    },
  },
  'crm.visit_plans.manage': {
    relations: ['self', 'direct', 'indirect', 'other'],
    probe: async (c, t) => {
      const changed = await call('PATCH', `/crm/visit-plans/${plans[t]}`, { ...as(c), body: { note: `Note by ${c}` } });
      const created = await call('POST', '/crm/visit-plans', { ...as(c), body: { salespersonUserId: who[t].userId, periodStart: freshMonth(), lines: [{ companyId, plannedVisits: 1 }] } });
      const made = allowedBy(created.status, 201);
      if (made) {
        expect(created.body.canEdit).toBe(true);
        const removed = await call('DELETE', `/crm/visit-plans/${created.body.id}`, as(c));
        expect(removed.status).toBe(204);
      }
      const edited = allowedBy(changed.status, 200);
      expect(made, `${c} → ${t}: create and change agree`).toBe(edited);
      return edited;
    },
  },

  // ---------------------------------------------------------------- Org structure (milestone 13)
  'org.directory': {
    relations: ['other'],
    probe: async (c, t) => (await ok('GET', '/people/employees', as(c))).employees.some((e: { id: string }) => e.id === emp[t]),
  },
  'org.employment': {
    probe: async (c, t) => {
      const card = await cardOf(c, t);
      const row = (await ok('GET', '/people/employees', as(c))).employees.find((e: { id: string }) => e.id === emp[t]);
      expect('employment' in row, `${c} → ${t}: list agrees with the card`).toBe('employment' in card);
      return 'employment' in card;
    },
  },
  'org.personal': {
    probe: async (c, t) => {
      const card = await cardOf(c, t);
      if (!('personal' in card)) expect(JSON.stringify(card)).not.toContain(privateEmail(t));
      else expect(card.personal.privateEmail).toBe(privateEmail(t));
      return 'personal' in card;
    },
  },
  'org.bank': {
    probe: async (c, t) => {
      const card = await cardOf(c, t);
      const reveal = await call('POST', `/people/employees/${emp[t]}/bank/reveal`, { ...as(c), body: { account: 'iban' } });
      const revealed = allowedBy(reveal.status, 200);
      if (!revealed) {
        expect(JSON.stringify(card)).not.toContain('•');
        expect(JSON.stringify(reveal.body)).not.toContain(IBAN.slice(4));
      }
      expect('bank' in card, `${c} → ${t}: card and reveal agree`).toBe(revealed);
      return revealed;
    },
  },
  'org.edit_own': {
    relations: ['self'],
    probe: async (c, t) => allowedBy((await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { workPhone: '+381 11 123', addressCity: 'Niš' } })).status, 200),
  },
  'org.edit_own_bank': {
    relations: ['self'],
    // "If setting on": with the setting off, only the roles whose cell says "Yes" still may.
    probe: async (c, t) => {
      const on = allowedBy((await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { bankName: 'Banka On' } })).status, 200);
      await ok('PATCH', '/workspace', { ...as('admin'), body: { employeeSelfEditBank: false } }, 200);
      try {
        const off = allowedBy((await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { bankName: 'Banka Off' } })).status, 200);
        expect(off, `${c} with the setting off`).toBe(ROLES[c].some((r) => permissionRow('org.edit_own_bank').cells[r].label === 'Yes'));
      } finally {
        await ok('PATCH', '/workspace', { ...as('admin'), body: { employeeSelfEditBank: true } }, 200);
      }
      return on;
    },
  },
  'org.employees.manage': {
    probe: async (c, t, rel) => {
      // Work fields of the person; and on yourself also an employment field (Admins only).
      const work = allowedBy((await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { jobTitle: `Title by ${c}` } })).status, 200);
      if (rel === 'self') {
        const employment = allowedBy((await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { weeklyHours: 39 } })).status, 200);
        expect(employment, `${c}: own employment fields`).toBe(ROLES[c].includes('admin'));
      }
      if (rel === 'other') {
        const created = await call('POST', '/people/employees', { ...as(c), body: { firstName: 'New', lastName: `Hire ${c}`, employmentStartDate: START } });
        expect(allowedBy(created.status, 201), `${c}: create`).toBe(work);
      }
      return work;
    },
  },
  'org.reporting': {
    probe: async (c, t) => {
      const r = await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { departmentId } });
      if (r.status === 200) await ok('PATCH', `/people/employees/${emp[t]}`, { ...as('admin'), body: { departmentId: null } }, 200);
      const m = await call('PATCH', `/people/employees/${emp[t]}`, { ...as(c), body: { managerId: null } });
      expect(allowedBy(m.status, 200), `${c} → ${t}: manager agrees with department`).toBe(r.status === 200);
      return allowedBy(r.status, 200);
    },
  },
  'org.structure': {
    relations: ['other'],
    probe: async (c) => {
      const r = await call('POST', '/people/departments', { ...as(c), body: { name: `Dept by ${c} ${Date.now()}` } });
      if (r.status === 201) await ok('DELETE', `/people/departments/${r.body.id}`, as('admin'));
      return allowedBy(r.status, 201);
    },
  },
  'org.import': { relations: ['other'], probe: async (c) => allowedBy((await call('GET', '/people/import/template', as(c))).status, 200) },
  'org.export': {
    relations: ['other'],
    probe: async (c, t) => allowedBy((await call('POST', '/people/employees/export', { ...as(c), body: { employeeIds: [emp[t]] } })).status, 200),
  },
  'org.deactivate': {
    relations: ['other'],
    probe: async (c) => {
      const e = await ok('POST', '/people/employees', { ...as('admin'), body: { firstName: 'Temp', lastName: `Leaver ${c}`, employmentStartDate: START } });
      const r = await call('POST', `/people/employees/${e.id}/deactivate`, { ...as(c), body: { lastWorkingDay: new Date().toISOString().slice(0, 10) } });
      return allowedBy(r.status, 200);
    },
  },
  'org.delete': {
    relations: ['other'],
    // Only once deactivated (CD-225): an active employee is a 409 even for an Admin.
    probe: async (c) => {
      const e = await ok('POST', '/people/employees', { ...as('admin'), body: { firstName: 'Temp', lastName: `Delete ${c}`, employmentStartDate: START } });
      expect((await call('DELETE', `/people/employees/${e.id}`, as(c))).status, `${c}: active`).toBe(c === 'admin' ? 409 : 403);
      await asTenantSql(tenant, `update employees set employment_end_date = '2026-01-31', deactivated_at = now() where id = $1`, [e.id]);
      const r = await call('DELETE', `/people/employees/${e.id}`, as(c));
      if (r.status !== 204) await ok('DELETE', `/people/employees/${e.id}`, as('admin'));
      return allowedBy(r.status, 204);
    },
  },
  'org.history': {
    probe: async (c, t) => allowedBy((await call('GET', `/people/history?entityType=employee&entityId=${emp[t]}`, as(c))).status, 200),
  },

  // ---------------------------------------------------------------- Settings
  'settings.own': {
    relations: ['self'],
    probe: async (c) => allowedBy((await call('PATCH', '/profile', { ...as(c), body: { notifyOrgChanges: true } })).status, 200),
  },
  'settings.team': {
    relations: ['other'],
    probe: async (c) => allowedBy((await call('POST', '/team/invitations', { ...as(c), body: { email: `invited-by-${c.replace('+', '-')}-${Date.now()}@example.test`, role: 'member' } })).status, 201),
  },
  'settings.workspace': {
    relations: ['other'],
    probe: async (c) => allowedBy((await call('PATCH', '/workspace', { ...as(c), body: { employeeDefaultWeeklyHours: 40 } })).status, 200),
  },
  'settings.roles_tab': {
    relations: ['other'],
    probe: async (c) => allowedBy((await call('GET', '/people/permissions', as(c))).status, 200),
  },
};

/** Rows whose endpoints other milestone-13 issues build; they become tests when those land. */
const LATER: Record<string, string> = {
  'org.invite': 'CD-140 (invite, link and unlink)',
};

const LIVE = PERMISSION_MODULES.filter((m) => m.live);

it('every row of the live modules has a test or is waiting for its issue', () => {
  for (const row of LIVE.flatMap((m) => m.rows)) expect(row.id in CASES || row.id in LATER, row.id).toBe(true);
});

for (const module of LIVE) {
  describe(module.name, () => {
    for (const row of module.rows) {
      if (row.id in LATER) {
        it.todo(`${row.action} (${LATER[row.id]})`);
        continue;
      }
      const c = CASES[row.id]!;
      describe(row.action, () => {
        for (const caller of CALLERS) {
          it(caller, async () => {
            const relations = (c.relations ?? (['self', 'direct', 'indirect', 'other'] as PermissionRelation[])).filter((r) => RELATED[caller][r]);
            for (const rel of relations) {
              const expected = c.expect ? c.expect(caller, rel) : allows(row.id, ROLES[caller], rel);
              expect(await c.probe(caller, RELATED[caller][rel]!, rel), `${row.id}: ${caller} → ${rel}`).toBe(expected);
            }
          });
        }
      });
    }
  });
}

it('inactive employees: the directory shows them to Admins only ("All, incl. inactive")', async () => {
  const gone = await ok('POST', '/people/employees', { ...as('admin'), body: { firstName: 'Gone', lastName: 'Matrix', employmentStartDate: START } });
  await asTenantSql(tenant, `update employees set employment_end_date = '2026-01-31', deactivated_at = now() where id = $1`, [gone.id]);
  const cells = permissionRow('org.directory').cells;
  for (const c of CALLERS) {
    const r = await call('GET', '/people/employees?status=inactive', as(c));
    const expected = ROLES[c].some((role) => cells[role].label.includes('inactive'));
    expect(r.status, c).toBe(expected ? 200 : 403);
    if (expected) expect(r.body.employees.map((e: { id: string }) => e.id)).toContain(gone.id);
    expect((await call('GET', `/people/employees/${gone.id}`, as(c))).status, c).toBe(expected ? 200 : 404);
  }
});

describe('Administration and Payroll are gone (CD-225)', () => {
  it('a leftover Administration or Payroll row gives nothing: Employee only, no HR data, no HR work', async () => {
    expect((await ok('GET', '/people/access', as('legacy'))).roles).toEqual(['employee']);
    expect((await call('GET', '/people/employees?status=inactive', as('legacy'))).status).toBe(403);
    const card = await cardOf('legacy', 'employee');
    for (const section of ['employment', 'personal', 'bank', 'hr']) expect(card).not.toHaveProperty(section);
    // Members get 403 on every HR write: create, edit others, manager, department, import, export, deactivate.
    for (const c of ['legacy', 'manager', 'employee'] as Person[]) {
      expect((await call('POST', '/people/employees', { ...as(c), body: { firstName: 'No', lastName: 'Way', employmentStartDate: START } })).status, c).toBe(403);
      expect((await call('PATCH', `/people/employees/${emp.other}`, { ...as(c), body: { jobTitle: 'Nope' } })).status, c).toBe(403);
      expect((await call('PATCH', `/people/employees/${emp.other}`, { ...as(c), body: { managerId: emp.manager } })).status, c).toBe(403);
      expect((await call('PATCH', `/people/employees/${emp.other}`, { ...as(c), body: { departmentId } })).status, c).toBe(403);
      expect((await call('POST', '/people/reporting-lines', { ...as(c), body: { employeeIds: [emp.other], managerId: emp.manager } })).status, c).toBe(403);
      expect((await call('POST', '/people/assignments', { ...as(c), body: { departmentId, employeeIds: [emp.other] } })).status, c).toBe(403);
      expect((await call('GET', '/people/import/template', as(c))).status, c).toBe(403);
      expect((await call('POST', '/people/employees/export', { ...as(c), body: { employeeIds: [emp.other] } })).status, c).toBe(403);
      expect((await call('POST', `/people/employees/${emp.other}/deactivate`, { ...as(c), body: { lastWorkingDay: '2031-01-01' } })).status, c).toBe(403);
    }
  });

  it('the role routes are gone', async () => {
    expect((await call('GET', '/people/roles', as('admin'))).status).toBe(404);
    expect((await call('PUT', `/people/employees/${emp.other}/roles/administration`, as('admin'))).status).toBe(404);
    expect((await call('DELETE', `/people/employees/${emp.legacy}/roles/payroll`, as('admin'))).status).toBe(404);
    expect(permissionMatrix().roles.map((r) => r.id)).toEqual(['employee', 'manager', 'admin']);
  });
});

describe('workspace role change (AC 9.7.4)', () => {
  it('making a member admin gives them Admin at once; making them a member again takes it away', async () => {
    expect((await call('GET', '/crm/bonus-rules', as('other'))).status).toBe(403);
    await ok('PATCH', `/team/members/${who.other.userId}`, { ...as('admin'), body: { role: 'admin' } }, 200);
    expect((await ok('GET', '/people/access', as('other'))).roles).toEqual(['employee', 'admin']);
    expect(await cardOf('other', 'employee')).toHaveProperty('bank.iban.last4');
    expect((await call('GET', `/crm/visit-plans/${plans.employee}`, as('other'))).status).toBe(200);
    expect((await call('PATCH', `/people/employees/${emp.lead}`, { ...as('other'), body: { jobTitle: 'Lead' } })).status).toBe(200);

    await ok('PATCH', `/team/members/${who.other.userId}`, { ...as('admin'), body: { role: 'member' } }, 200);
    expect((await ok('GET', '/people/access', as('other'))).roles).toEqual(['employee']);
    expect(await cardOf('other', 'employee')).not.toHaveProperty('bank');
    expect((await call('GET', `/crm/visit-plans/${plans.employee}`, as('other'))).status).toBe(404);
    expect((await call('PATCH', `/people/employees/${emp.lead}`, { ...as('other'), body: { jobTitle: 'Lead again' } })).status).toBe(403);
  });
});

describe('no personal details or IBAN for callers who may not see them (AC 9.7.5)', () => {
  it('lists, cards and history of others carry none, for every role without the right', async () => {
    const IBAN_DIGITS = IBAN.slice(4);
    for (const c of CALLERS) {
      const list = JSON.stringify(await ok('GET', '/people/employees', as(c)));
      for (const p of Object.keys(emp) as Person[]) expect(list, `${c}: list`).not.toContain(privateEmail(p));
      expect(list).not.toContain('•');
      for (const t of ['employee', 'other'] as Person[]) {
        if (t === RELATED[c].self) continue;
        const card = JSON.stringify(await cardOf(c, t));
        const rel = relationOf(c, t);
        const personal = allows('org.personal', ROLES[c], rel);
        if (!personal) expect(card, `${c} → ${t}`).not.toContain(privateEmail(t));
        if (!allows('org.bank', ROLES[c], rel)) {
          expect(card, `${c} → ${t}`).not.toContain('•');
          expect(card).not.toContain(IBAN_DIGITS);
        }
        const history = await call('GET', `/people/history?entityType=employee&entityId=${emp[t]}`, as(c));
        if (history.status === 200 && !personal) expect(JSON.stringify(history.body)).not.toContain(privateEmail(t));
      }
    }
  });
});
