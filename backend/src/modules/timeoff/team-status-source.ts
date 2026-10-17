import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { sickLeaves, timeoffReasons, timeoffRequestDays, timeoffRequests } from '../../shared/database/schema';
import { type StatusAbsence, statusAbsenceRegistry, type StatusAbsenceSource } from '../timesheet';
import { labelOf } from './timesheet-sync';

/**
 * Time off and sick leave for Today's status (CD-162, spec 15 section 12.2). Registered with the
 * timesheet module's registry on start. An approved request covers the dates from its first to
 * its last counted day, weekends inside included, except a day that was cancelled, returned or
 * interrupted by sick leave; active sick leave covers its period (open: from its start on). The
 * label never names the type of sick leave.
 */
@Injectable()
export class TeamStatusSource implements StatusAbsenceSource, OnModuleInit {
  onModuleInit(): void {
    statusAbsenceRegistry.use(this);
  }

  async coveringOn(tx: Tx, employeeIds: string[], date: string): Promise<Map<string, StatusAbsence[]>> {
    const out = new Map<string, StatusAbsence[]>();
    if (!employeeIds.length) return out;
    const add = (id: string, a: StatusAbsence) => out.set(id, [...(out.get(id) ?? []), a]);

    const reason = sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests.reasonId})`;
    const first = sql<string>`min(${timeoffRequestDays.date})::text`;
    const last = sql<string>`max(${timeoffRequestDays.date})::text`;
    const requests = await tx
      .select({ employeeId: timeoffRequests.employeeId, type: timeoffRequests.type, reason, first, last })
      .from(timeoffRequests)
      .innerJoin(timeoffRequestDays, and(eq(timeoffRequestDays.requestId, timeoffRequests.id), eq(timeoffRequestDays.state, 'counted')))
      .where(
        and(
          inArray(timeoffRequests.employeeId, employeeIds),
          eq(timeoffRequests.status, 'approved'),
          lte(timeoffRequests.startDate, date),
          gte(timeoffRequests.endDate, date),
          sql`not exists (select 1 from ${timeoffRequestDays} x where x.request_id = ${timeoffRequests.id} and x.date = ${date} and x.state <> 'counted')`,
        ),
      )
      .groupBy(timeoffRequests.id)
      .having(sql`min(${timeoffRequestDays.date}) <= ${date} and max(${timeoffRequestDays.date}) >= ${date}`);
    for (const r of requests) add(r.employeeId, { kind: 'time_off', label: labelOf(r.type, r.reason), from: r.first, to: r.last });

    const sick = await tx
      .select({ employeeId: sickLeaves.employeeId, from: sickLeaves.startDate, to: sickLeaves.endDate })
      .from(sickLeaves)
      .where(and(inArray(sickLeaves.employeeId, employeeIds), inArray(sickLeaves.status, ['reported', 'confirmed']), lte(sickLeaves.startDate, date), or(isNull(sickLeaves.endDate), gte(sickLeaves.endDate, date))));
    for (const s of sick) add(s.employeeId, { kind: 'sick_leave', label: 'Sick leave', from: s.from, to: s.to });
    return out;
  }

  /** "Vacation requested" for a request waiting for a decision that covers the date. */
  async requestedOn(tx: Tx, employeeIds: string[], date: string): Promise<Map<string, string>> {
    if (!employeeIds.length) return new Map();
    const rows = await tx
      .select({ employeeId: timeoffRequests.employeeId, type: timeoffRequests.type, reason: sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests.reasonId})` })
      .from(timeoffRequests)
      .where(and(inArray(timeoffRequests.employeeId, employeeIds), eq(timeoffRequests.status, 'pending'), lte(timeoffRequests.startDate, date), gte(timeoffRequests.endDate, date)))
      .orderBy(timeoffRequests.startDate);
    const out = new Map<string, string>();
    for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, `${labelOf(r.type, r.reason)} requested`);
    return out;
  }
}
