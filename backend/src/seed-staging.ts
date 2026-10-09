import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { AppModule } from './app.module';
import { loadEnv } from './infrastructure/config/env';
import { CompaniesService, ContactsService, DealsService, FunnelsService, MeetingsService, ProductsService } from './modules/crm';
import { AccountDirectory, AccountError, IdentityService, SessionProvider, SettingsService } from './modules/identity';
import { EmployeesService, linkNewMember, OrgService } from './modules/people';
import { ProjectMembersService, ProjectsService, ProjectTypesService, TasksService, WorkOrdersService } from './modules/projects';
import { TimesheetService } from './modules/timesheet';
import type { TenantContext } from './shared/authorization';
import { DatabaseService } from './shared/database/database.service';
import { requestActor } from './shared/database/request-context';
import { employees, invitations as invitationsTable, type MembershipRole, memberships, tenants, users } from './shared/database/schema';

/**
 * The staging seed (CD-313): two workspaces, each with an owner, an admin and a member, and a few
 * records in every module (companies, contacts, products, deals, a meeting, employees with an org
 * unit and a CEO, a project with tasks, a work order, a submitted timesheet week), so a person who
 * doesn't read code can run docs/STAGING_CHECK.md. Run inside the api container on the server:
 *
 *   APP_DIR=/opt/crm-staging bash scripts/seed-staging.sh         (docker compose run --rm api node dist/seed-staging.js)
 *
 * Idempotent: a workspace that exists is deleted and built again, so a second run ends in the same
 * state. The accounts stay (their password is set again) and are printed at the end. With
 * AUTH_MODE=oidc the accounts are created at the identity provider through the Management API and
 * signed in once to learn their subject; with AUTH_MODE=dev any password works. It refuses to run
 * on production (NODE_ENV=production and an APP_URL without "staging") unless SEED_ALLOW_PRODUCTION=yes.
 */

type Role = MembershipRole;

interface Person {
  role: Role;
  name: string;
  jobTitle: string;
}

interface Workspace {
  key: 'a' | 'b';
  name: string;
  people: Person[];
  companies: { name: string; industry: string; hq: string; contact: string; contactTitle: string }[];
  products: { name: string; unitPrice: string; unit: string }[];
  deals: { title: string; company: number; amount: string; stage: number }[];
  meeting: { title: string; company: number; agenda: string };
  unit: string;
  project: { name: string; company: number; tasks: string[] };
  workOrder: { title: string; company: number; location: string };
}

const EMAIL_DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'example.com';

const WORKSPACES: Workspace[] = [
  {
    key: 'a',
    name: 'Seed Alpha',
    people: [
      { role: 'owner', name: 'Ana Alpha', jobTitle: 'Managing director' },
      { role: 'admin', name: 'Adam Alpha', jobTitle: 'Operations manager' },
      { role: 'member', name: 'Mila Alpha', jobTitle: 'Field technician' },
    ],
    companies: [
      { name: 'Alpha Bakery', industry: 'Food', hq: 'Novi Sad', contact: 'Bojan Alpha-Bakery', contactTitle: 'Owner' },
      { name: 'Alpha Dental Clinic', industry: 'Healthcare', hq: 'Belgrade', contact: 'Dr Lena Alpha-Dental', contactTitle: 'Director' },
      { name: 'Alpha Logistics', industry: 'Transport', hq: 'Niš', contact: 'Petar Alpha-Logistics', contactTitle: 'Fleet manager' },
    ],
    products: [
      { name: 'Alpha installation', unitPrice: '1200', unit: 'job' },
      { name: 'Alpha maintenance visit', unitPrice: '150', unit: 'visit' },
    ],
    deals: [
      { title: 'Alpha Bakery: oven line', company: 0, amount: '4800', stage: 0 },
      { title: 'Alpha Dental: two treatment rooms', company: 1, amount: '9600', stage: 1 },
      { title: 'Alpha Logistics: depot heating', company: 2, amount: '15000', stage: 0 },
    ],
    meeting: { title: 'Alpha Bakery kick-off', company: 0, agenda: 'Site visit, timeline, who signs off.' },
    unit: 'Alpha Field Service',
    project: { name: 'Alpha Dental fit-out', company: 1, tasks: ['Alpha: measure the rooms', 'Alpha: order the units', 'Alpha: install and test'] },
    workOrder: { title: 'Alpha Bakery: oven inspection', company: 0, location: 'Alpha Bakery, Novi Sad' },
  },
  {
    key: 'b',
    name: 'Seed Bravo',
    people: [
      { role: 'owner', name: 'Boris Bravo', jobTitle: 'Founder' },
      { role: 'admin', name: 'Bela Bravo', jobTitle: 'Office manager' },
      { role: 'member', name: 'Marko Bravo', jobTitle: 'Service engineer' },
    ],
    companies: [
      { name: 'Bravo Hotels', industry: 'Hospitality', hq: 'Zlatibor', contact: 'Jelena Bravo-Hotels', contactTitle: 'General manager' },
      { name: 'Bravo Print Shop', industry: 'Printing', hq: 'Subotica', contact: 'Igor Bravo-Print', contactTitle: 'Owner' },
      { name: 'Bravo Schools', industry: 'Education', hq: 'Kragujevac', contact: 'Sanja Bravo-Schools', contactTitle: 'Facilities lead' },
    ],
    products: [
      { name: 'Bravo cooling unit', unitPrice: '2400', unit: 'unit' },
      { name: 'Bravo service hour', unitPrice: '60', unit: 'hour' },
    ],
    deals: [
      { title: 'Bravo Hotels: lobby cooling', company: 0, amount: '7200', stage: 1 },
      { title: 'Bravo Print Shop: workshop ventilation', company: 1, amount: '3900', stage: 0 },
      { title: 'Bravo Schools: gym heating', company: 2, amount: '22000', stage: 0 },
    ],
    meeting: { title: 'Bravo Hotels walk-through', company: 0, agenda: 'Lobby layout, noise limits, budget.' },
    unit: 'Bravo Service Team',
    project: { name: 'Bravo Hotels lobby', company: 0, tasks: ['Bravo: survey the lobby', 'Bravo: deliver the units', 'Bravo: commission and hand over'] },
    workOrder: { title: 'Bravo Print Shop: filter change', company: 1, location: 'Bravo Print Shop, Subotica' },
  },
];

/** Tenant tables in an order that satisfies the restrict foreign keys; cascades take their children. */
const PURGE_ORDER = [
  'time_entries', 'timesheet_rows', 'timesheet_days', 'timesheet_weeks', 'timesheet_notices', 'timesheet_deadline_runs', 'public_holidays',
  'task_limit_alerts', 'task_time_fixtures', 'tasks', 'task_counters', 'work_orders', 'work_order_counters', 'projects', 'project_types',
  'meetings', 'visit_plans', 'deals', 'contacts', 'companies', 'products', 'custom_field_defs', 'sales_bonus_rules', 'sales_bonus_settings',
  'document_templates', 'daily_digests', 'sample_records', 'funnels', 'employees', 'org_units', 'org_levels', 'departments', 'teams',
] as const;

const emailOf = (ws: Workspace, p: Person) => `seed-${ws.key}-${p.role}@${EMAIL_DOMAIN}`;

/** Letters, digits and symbols: meets the usual provider password policy. */
const newPassword = () => `Seed-${randomBytes(9).toString('base64url')}-9x!`;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** The Monday of the week `d` is in (UTC). */
const mondayOf = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

const log = (line: string) => console.log(`[seed] ${line}`);

async function main() {
  const env = loadEnv();
  const onProduction = env.NODE_ENV === 'production' && !/staging/i.test(env.APP_URL);
  if (onProduction && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
    console.error(`[seed] refusing: APP_URL=${env.APP_URL} does not look like staging. Set SEED_ALLOW_PRODUCTION=yes only if you really want seed workspaces there.`);
    process.exit(2);
  }
  if (env.MAIL_DRIVER !== 'log') log(`WARNING: MAIL_DRIVER=${env.MAIL_DRIVER}; the worker will try to email the seed accounts (@${EMAIL_DOMAIN}).`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const seed = new Seed(app.get(DatabaseService), {
      accounts: app.get(AccountDirectory),
      sessions: app.get(SessionProvider),
      identity: app.get(IdentityService),
      settings: app.get(SettingsService),
      companies: app.get(CompaniesService),
      contacts: app.get(ContactsService),
      products: app.get(ProductsService),
      funnels: app.get(FunnelsService),
      deals: app.get(DealsService),
      meetings: app.get(MeetingsService),
      employees: app.get(EmployeesService),
      org: app.get(OrgService),
      projectTypes: app.get(ProjectTypesService),
      projects: app.get(ProjectsService),
      projectMembers: app.get(ProjectMembersService),
      tasks: app.get(TasksService),
      workOrders: app.get(WorkOrdersService),
      timesheet: app.get(TimesheetService),
    });
    const password = process.env.SEED_PASSWORD || newPassword();
    const started = Date.now();
    for (const ws of WORKSPACES) await seed.workspace(ws, password);
    log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
    seed.printAccounts(env.APP_URL, password, env.AUTH_MODE);
  } finally {
    await app.close();
  }
}

interface Services {
  accounts: AccountDirectory;
  sessions: SessionProvider;
  identity: IdentityService;
  settings: SettingsService;
  companies: CompaniesService;
  contacts: ContactsService;
  products: ProductsService;
  funnels: FunnelsService;
  deals: DealsService;
  meetings: MeetingsService;
  employees: EmployeesService;
  org: OrgService;
  projectTypes: ProjectTypesService;
  projects: ProjectsService;
  projectMembers: ProjectMembersService;
  tasks: TasksService;
  workOrders: WorkOrdersService;
  timesheet: TimesheetService;
}

interface Account {
  userId: string;
  authSubject: string;
  email: string;
  person: Person;
  employeeId?: string;
}

class Seed {
  private readonly accounts: { workspace: string; account: Account }[] = [];

  constructor(
    private readonly database: DatabaseService,
    private readonly s: Services,
  ) {}

  async workspace(ws: Workspace, password: string) {
    log(`workspace "${ws.name}"`);
    const people: Account[] = [];
    for (const p of ws.people) people.push(await this.ensureAccount(emailOf(ws, p), p, password));
    const [owner, admin, member] = people as [Account, Account, Account];

    await this.resetWorkspace(ws.name, owner.userId);
    const tenant = await this.s.identity.createTenant(owner.userId, ws.name, 'EUR', 'Europe/Belgrade');
    const tenantId = tenant.id;
    for (const a of [admin, member]) {
      await this.database.withTenant(tenantId, async (tx) => {
        await tx.insert(memberships).values({ tenantId, userId: a.userId, role: a.person.role }).onConflictDoNothing();
        await linkNewMember(tx, { tenantId, userId: a.userId });
      });
    }
    const employeeIds = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .where(inArray(employees.userId, people.map((p) => p.userId))),
    );
    for (const a of people) a.employeeId = employeeIds.find((e) => e.userId === a.userId)?.id;
    for (const a of people) if (!a.employeeId) throw new Error(`${a.email} has no employee record in ${ws.name}`);
    this.accounts.push(...people.map((account) => ({ workspace: ws.name, account })));
    const ctx = (a: Account): TenantContext => ({ tenantId, userId: a.userId, role: a.person.role });
    const as = <T>(a: Account, fn: (ctx: TenantContext) => Promise<T>): Promise<T> => requestActor.run({ userId: a.userId }, () => fn(ctx(a)));

    // People: job titles, the member is a technician, a unit, a reporting line and the CEO.
    for (const a of people) await as(owner, (c) => this.s.employees.update(c, a.employeeId!, { jobTitle: a.person.jobTitle, ...(a === member ? { workType: 'both' as const } : {}) }));
    const levels = await as(owner, (c) => this.s.org.levels(c));
    const level = levels.find((l) => /department/i.test(l.name)) ?? levels[0];
    if (!level) throw new Error('no org level');
    const unit = await as(owner, (c) => this.s.org.createUnit(c, { levelId: level.id, name: ws.unit, leadEmployeeId: admin.employeeId! }));
    await as(owner, (c) => this.s.org.assign(c, { unitId: unit.unit.id, employeeIds: [admin.employeeId!, member.employeeId!] }));
    await as(owner, (c) => this.s.org.setReportingLines(c, { employeeIds: [member.employeeId!], managerId: admin.employeeId! }));
    await as(owner, (c) => this.s.settings.updateWorkspace(c, { ceoEmployeeId: owner.employeeId! }));
    log(`  people: ${people.length} employees, unit "${ws.unit}", CEO ${owner.person.name}`);

    // CRM: companies with a contact each, products, deals in the first funnel, one meeting.
    const companyIds: string[] = [];
    for (const c of ws.companies) {
      const company = await as(owner, (x) => this.s.companies.create(x, { name: c.name, industry: c.industry, hq: c.hq }));
      companyIds.push(company.id);
      await as(admin, (x) => this.s.contacts.create(x, { fullName: c.contact, companyId: company.id, jobTitle: c.contactTitle, buyerRole: 'Decision maker' }));
    }
    for (const p of ws.products) await as(owner, (x) => this.s.products.create(x, { name: p.name, unitPrice: p.unitPrice, unit: p.unit }));
    const [funnel] = await as(owner, (x) => this.s.funnels.list(x));
    if (!funnel) throw new Error('no funnel');
    const open = funnel.stages.filter((st) => !st.isWon);
    const dealIds: string[] = [];
    for (const d of ws.deals) {
      const deal = await as(owner, (x) => this.s.deals.create(x, { title: d.title, funnelId: funnel.id, companyId: companyIds[d.company]!, amount: d.amount, ownerUserId: admin.userId }));
      dealIds.push(deal.id);
      const stage = open[Math.min(d.stage, open.length - 1)];
      if (d.stage > 0 && stage) await as(admin, (x) => this.s.deals.moveToStage(x, deal.id, stage.id));
    }
    const tomorrow = addDays(new Date(), 1);
    const at = (hour: number) => new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), hour)).toISOString();
    await as(admin, (x) =>
      this.s.meetings.create(x, { title: ws.meeting.title, type: 'online', startsAt: at(9), endsAt: at(10), companyId: companyIds[ws.meeting.company]!, dealId: dealIds[ws.meeting.company]!, agenda: ws.meeting.agenda }),
    );
    log(`  crm: ${ws.companies.length} companies and contacts, ${ws.products.length} products, ${ws.deals.length} deals, 1 meeting`);

    // Projects: one project led by the admin, the member on the team, tasks assigned to the member; a work order for the member.
    const [type] = await as(owner, (x) => this.s.projectTypes.list(x));
    if (!type) throw new Error('no project type');
    const today = new Date();
    const project = await as(owner, (x) =>
      this.s.projects.create(x, { name: ws.project.name, projectTypeId: type.id, companyId: companyIds[ws.project.company]!, dealId: dealIds[ws.project.company]!, leadUserId: admin.userId, startDate: isoDate(addDays(today, -14)), budgetHours: 120 }),
    );
    await as(admin, (x) => this.s.projectMembers.add(x, project.id, { employeeIds: [member.employeeId!] }));
    const taskIds: string[] = [];
    for (const [i, name] of ws.project.tasks.entries()) {
      const task = await as(admin, (x) => this.s.tasks.create(x, { projectId: project.id, name, dueDate: isoDate(addDays(today, 7 * (i + 1))), estimateHours: 8, assigneeIds: [member.employeeId!] }));
      taskIds.push(task.id);
    }
    const nextMonday = addDays(mondayOf(today), 7);
    await as(owner, (x) =>
      this.s.workOrders.create(x, { title: ws.workOrder.title, companyId: companyIds[ws.workOrder.company]!, type: 'inspection', technicianIds: [member.employeeId!], scheduledDate: isoDate(nextMonday), scheduledStart: '09:00', durationHours: 2, location: ws.workOrder.location }),
    );
    log(`  projects: "${ws.project.name}" with ${taskIds.length} tasks, 1 work order`);

    // Timesheet: the member logged last week (submitted, so the admin has something to approve) and this Monday (draft).
    const lastMonday = addDays(mondayOf(today), -7);
    for (const [i, minutes] of [240, 180, 300].entries()) {
      await as(member, (x) => this.s.timesheet.createEntry(x, { taskId: taskIds[i % taskIds.length]!, date: isoDate(addDays(lastMonday, i)), minutes }));
    }
    await as(member, (x) => this.s.timesheet.submit(x, isoDate(lastMonday)));
    await as(member, (x) => this.s.timesheet.createEntry(x, { taskId: taskIds[0]!, date: isoDate(mondayOf(today)), minutes: 120 }));
    log(`  timesheet: last week submitted (12 h), this week 2 h`);
  }

  /**
   * The account for an email, at the identity provider and in `users`. An existing one gets the
   * password set again (so the printed credentials always work); a new one is created at the
   * provider and signed in once, which is how its subject becomes known.
   */
  private async ensureAccount(email: string, person: Person, password: string): Promise<Account> {
    const [existing] = await this.database.db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    let userId: string;
    let authSubject: string;
    if (existing) {
      const providerId = existing.authSubject.slice(existing.authSubject.indexOf('|') + 1);
      // Only a password account of the provider's database connection gets its password set; a
      // social or unknown subject under a seed address means the address is not ours to reset.
      if (loadEnv().AUTH_MODE !== 'dev' && !providerId.startsWith('auth0|')) {
        throw new Error(`${email} belongs to an account that doesn't sign in with a password (${providerId}); choose another SEED_EMAIL_DOMAIN`);
      }
      await this.s.accounts.setPassword(providerId, password);
      userId = existing.id;
      authSubject = existing.authSubject;
    } else {
      try {
        await this.s.accounts.createPasswordUser(email, password);
      } catch (err) {
        if (!(err instanceof AccountError) || err.reason !== 'exists') throw err;
        log(`${email} already exists at the identity provider but not here; signing in with the given SEED_PASSWORD`);
      }
      const tokens = await this.s.sessions.passwordLogin(email, password, '127.0.0.1');
      if (!tokens.identity) throw new Error(`the identity provider returned no ID token for ${email}; the sign-in app needs the openid scope`);
      const user = await this.s.identity.resolveUser(tokens.identity);
      userId = user.id;
      authSubject = user.authSubject;
    }
    // Name and finished onboarding, so the app opens on the workspace, not on "About you".
    await this.database.db
      .update(users)
      .set({ displayName: person.name, displayNameCustom: true, jobTitle: person.jobTitle, onboardingSteps: ['profile', 'team'], onboardedAt: sql`coalesce(${users.onboardedAt}, now())` })
      .where(eq(users.id, userId));
    this.s.identity.forgetUser(authSubject);
    return { userId, authSubject, email, person };
  }

  /**
   * Deletes the seed workspace of this name that `ownerId` owns, with everything in it. Not a
   * cascade from `tenants`: the history triggers would insert into record_changes for a tenant
   * that no longer exists. So the records go first, inside the tenant context and filtered by
   * tenant_id, in an order the restrict foreign keys and the time-entry lock allow; then the
   * membership rows and the tenant, whose remaining cascades (audit_logs, record_changes) have
   * no triggers. Other workspaces are never touched (test/integration/seed-staging.spec.ts).
   */
  private async resetWorkspace(name: string, ownerId: string) {
    const rows = await this.database.db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(memberships, eq(memberships.tenantId, tenants.id))
      .where(and(eq(tenants.name, name), eq(memberships.userId, ownerId), eq(memberships.role, 'owner')));
    for (const row of rows) {
      await this.database.withTenant(row.id, async (tx) => {
        // Submitted and approved days lock their entries; a draft day lets them go.
        // RLS already keeps this inside the workspace; the filter makes it true for a role that bypasses RLS too.
        await tx.execute(sql`update timesheet_days set status = 'draft' where tenant_id = ${row.id}`);
        for (const table of PURGE_ORDER) await tx.execute(sql`delete from ${sql.identifier(table)} where tenant_id = ${row.id}`);
        await tx.delete(invitationsTable).where(eq(invitationsTable.tenantId, row.id));
        await tx.delete(memberships).where(eq(memberships.tenantId, row.id));
      });
      await this.database.db.delete(tenants).where(eq(tenants.id, row.id));
      log(`  removed the previous "${name}" (${row.id})`);
    }
  }

  printAccounts(appUrl: string, password: string, authMode: string) {
    console.log('');
    console.log(`Sign in at ${appUrl} with ${authMode === 'dev' ? 'any password (dev sign-in)' : `the password: ${password}`}`);
    console.log('');
    console.log('| Workspace   | Role   | Name          | Email                        |');
    console.log('|-------------|--------|---------------|------------------------------|');
    for (const { workspace, account } of this.accounts) {
      console.log(`| ${workspace.padEnd(11)} | ${account.person.role.padEnd(6)} | ${account.person.name.padEnd(13)} | ${account.email.padEnd(28)} |`);
    }
    console.log('');
    console.log('Each person belongs to one workspace only. Test accounts, not real people: never use them on production.');
  }
}

main().catch((err: unknown) => {
  console.error('[seed] failed:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
