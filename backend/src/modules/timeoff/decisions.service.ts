import { ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { employees, type HrDocumentRow, type HrDocumentState, type HrDocumentStatus, hrDocuments, tenants, type TimeoffRequestRow, timeoffRequestDays, timeoffRequests, vacationEntitlements } from '../../shared/database/schema';
import { documentRenderers, HrDocumentsService } from '../hr-documents';
import { PeopleAccess } from '../people';
import { holidaysBetween, timesheetSettings } from '../timesheet';
import { BalancesService } from './balances.service';
import { type CompanyDetails, type VacationDecisionData, vacationDecisionRenderer } from './decision-document';
import { addDays } from './request-rules';
import { workspaceToday } from './today';

/** What the request list and the Decisions tab show about a decision (spec 11.5). */
export interface DecisionView {
  id: string;
  number: string;
  version: number;
  status: HrDocumentStatus;
  error: string | null;
  state: HrDocumentState;
  year: number;
  emailedTo: string[] | null;
  emailedAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

export interface DecisionRow extends DecisionView {
  employee: { id: string; fullName: string };
  requestId: string;
  startDate: string;
  endDate: string;
  workingDays: number;
}

export interface DecisionsFilters {
  year?: number;
  state?: HrDocumentState;
  employeeId?: string;
}

const TYPE = 'vacation_decision' as const;
const WEEKDAY = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * The vacation decision document (CD-167, spec 11): queued by the approval of a vacation request
 * in a Serbian workspace (Settings → Workspace → Country), generated and emailed by the
 * hr-documents engine. The employee sees and downloads their own, Admins everyone's; managers
 * never (spec 15.1). Cancelling marks it cancelled, shortening outdated; Admins regenerate.
 */
@Injectable()
export class DecisionsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: HrDocumentsService,
    private readonly balances: BalancesService,
    private readonly access: PeopleAccess,
  ) {}

  onModuleInit(): void {
    documentRenderers.set(TYPE, vacationDecisionRenderer as never);
  }

  /** After an approval (spec 11.1), in its transaction: a decision when the workspace's country is Serbia; else nothing. */
  async queueFor(tx: Tx, ctx: TenantContext, row: TimeoffRequestRow): Promise<HrDocumentRow | null> {
    const snapshot = await this.snapshot(tx, ctx.tenantId, row);
    if (!snapshot) return null;
    return this.documents.queue(tx, { tenantId: ctx.tenantId, type: TYPE, sourceId: row.id, employeeId: row.employeeId, year: snapshot.year, snapshot, createdByUserId: ctx.userId });
  }

  /** The request was cancelled or shortened (spec 11.5): its decision says so; the PDF stays. */
  sourceChanged(tx: Tx, requestId: string, state: 'cancelled' | 'outdated'): Promise<void> {
    return this.documents.setState(tx, TYPE, requestId, state);
  }

  /** The current decision of each request, for the request views; the caller limits who sees them. */
  async viewsFor(tx: Tx, requestIds: string[]): Promise<Map<string, DecisionView>> {
    const current = await this.documents.currentFor(tx, TYPE, requestIds);
    return new Map([...current].map(([requestId, doc]) => [requestId, view(doc)]));
  }

  /** The Decisions tab (Admins): newest first. */
  list(ctx: TenantContext, filters: DecisionsFilters): Promise<DecisionRow[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const where = [eq(hrDocuments.type, TYPE)];
      if (filters.year) where.push(eq(hrDocuments.year, filters.year));
      if (filters.state) where.push(eq(hrDocuments.state, filters.state));
      if (filters.employeeId) where.push(eq(hrDocuments.employeeId, filters.employeeId));
      const rows = await tx
        .select({ doc: hrDocuments, fullName: employees.fullName, startDate: timeoffRequests.startDate, endDate: timeoffRequests.endDate, workingDays: timeoffRequests.workingDays })
        .from(hrDocuments)
        .innerJoin(employees, eq(employees.id, hrDocuments.employeeId))
        .innerJoin(timeoffRequests, eq(timeoffRequests.id, hrDocuments.sourceId))
        .where(and(...where))
        .orderBy(desc(hrDocuments.createdAt));
      return rows.map((r) => ({ ...view(r.doc), employee: { id: r.doc.employeeId, fullName: r.fullName }, requestId: r.doc.sourceId, startDate: r.startDate, endDate: r.endDate, workingDays: r.workingDays }));
    });
  }

  /** The PDF: the employee's own, or any as an Admin (spec 15.1); 404 otherwise, 409 while not ready. */
  pdf(ctx: TenantContext, id: string): Promise<{ name: string; content: Buffer }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      if (doc.status !== 'ready') throw new ConflictException(doc.status === 'failed' ? `Not generated: ${doc.error}` : 'The document is still being generated');
      const file = await this.documents.file(doc);
      if (!file) throw new NotFoundException('Document file not found');
      return file;
    });
  }

  /** "Confirm receipt" (spec 11.4): the employee themselves, once. */
  acknowledge(ctx: TenantContext, id: string): Promise<DecisionView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      const access = await this.access.of(ctx, tx);
      if (!access.isSelf(doc.employeeId)) throw new ForbiddenException('Only the employee confirms receipt of their decision');
      return view((await this.documents.acknowledge(tx, id)) ?? doc);
    });
  }

  /** A new version from the current data (spec 11.5), Admins; the number stays. */
  regenerate(ctx: TenantContext, id: string, email: boolean): Promise<DecisionView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const doc = await this.visible(tx, ctx, id);
      if (doc.state === 'superseded') throw new ConflictException('A newer version exists; regenerate that one');
      const [request] = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.id, doc.sourceId));
      if (!request || request.status !== 'approved') throw new ConflictException('The request is no longer approved');
      const snapshot = await this.snapshot(tx, ctx.tenantId, request);
      if (!snapshot) throw new ConflictException('The workspace\'s country is not Serbia: no decision document');
      return view(await this.documents.newVersion(tx, doc, snapshot, ctx.userId, email));
    });
  }

  private async visible(tx: Tx, ctx: TenantContext, id: string): Promise<HrDocumentRow> {
    const [doc] = await tx.select().from(hrDocuments).where(and(eq(hrDocuments.id, id), eq(hrDocuments.type, TYPE)));
    const access = await this.access.of(ctx, tx);
    if (!doc || !(access.isAdmin || access.isSelf(doc.employeeId))) throw new NotFoundException('Decision not found');
    return doc;
  }

  /** The values the document is made of (spec 11.2), from the request as it is now; null unless the country is Serbia. */
  private async snapshot(tx: Tx, tenantId: string, row: TimeoffRequestRow): Promise<VacationDecisionData | null> {
    const [t] = await tx
      .select({ country: tenants.country, company: { legalName: tenants.companyLegalName, address: tenants.companyAddress, pib: tenants.companyPib, mb: tenants.companyMb, place: tenants.companyPlace, signatoryName: tenants.companySignatoryName, signatoryTitle: tenants.companySignatoryTitle, legalBasis: tenants.decisionLegalBasis } })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (t?.country !== 'RS') return null;
    const [e] = await tx.select({ fullName: employees.fullName, jobTitle: employees.jobTitle }).from(employees).where(eq(employees.id, row.employeeId));
    const days = await tx.select({ date: timeoffRequestDays.date, poolYear: timeoffRequestDays.poolYear }).from(timeoffRequestDays).where(and(eq(timeoffRequestDays.requestId, row.id), eq(timeoffRequestDays.state, 'counted'))).orderBy(asc(timeoffRequestDays.date));
    const byPool = new Map<number, number>();
    for (const d of days) {
      const year = d.poolYear ?? Number(d.date.slice(0, 4));
      byPool.set(year, (byPool.get(year) ?? 0) + 1);
    }
    const pools = [...byPool].map(([year, n]) => ({ year, days: n })).sort((a, b) => a.year - b.year);
    const year = pools[0]?.year ?? Number(row.startDate.slice(0, 4));
    const [ent] = await tx.select().from(vacationEntitlements).where(and(eq(vacationEntitlements.employeeId, row.employeeId), eq(vacationEntitlements.year, year)));
    // The request is approved by now, so the year's remaining days already exclude it.
    const pc = await this.balances.poolContext(tx, tenantId, row.employeeId, [year - 1, year]);
    const settings = await timesheetSettings(tx, tenantId);
    const holidays = await holidaysBetween(tx, row.startDate, addDays(row.endDate, 60));
    const isWorkingDay = (date: string) => settings.workingDays.includes(WEEKDAY(date)) && !holidays.has(date);
    let returnDate = addDays(row.endDate, 1);
    while (!isWorkingDay(returnDate)) returnDate = addDays(returnDate, 1);
    const inside = [...holidays.values()].filter((h) => h.date >= row.startDate && h.date <= row.endDate && settings.workingDays.includes(WEEKDAY(h.date)));
    return {
      company: t.company satisfies CompanyDetails,
      issuedOn: await workspaceToday(tx, tenantId),
      requestedOn: await workspaceToday(tx, tenantId, row.submittedAt),
      employee: { fullName: e?.fullName ?? 'Employee', jobTitle: e?.jobTitle ?? null },
      year,
      entitlement: ent ? { totalDays: ent.totalDays, baseDays: ent.baseDays, experienceDays: ent.experienceDays, experienceYears: ent.experienceYears, individualDays: ent.individualDays, individualReason: ent.individualReason, monthsWorked: ent.monthsWorked } : null,
      whole: !!pc && pc.balance(year).remaining === 0,
      startDate: row.startDate,
      endDate: row.endDate,
      workingDays: days.length,
      returnDate,
      pools,
      holidays: inside.map((h) => ({ date: h.date, name: h.name })),
    };
  }
}

const view = (doc: HrDocumentRow): DecisionView => ({ id: doc.id, number: doc.number, version: doc.version, status: doc.status, error: doc.error, state: doc.state, year: doc.year, emailedTo: doc.emailedTo, emailedAt: doc.emailedAt, acknowledgedAt: doc.acknowledgedAt, createdAt: doc.createdAt });

