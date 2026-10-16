import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { timeoffRequestDays, timeoffRequests } from '../../shared/database/schema';
import { type AbsenceSource, absenceRegistry } from '../people';

/**
 * Who is absent on a date (spec 9.1, "manager absent"): employees with an approved time off day
 * then (sick leave joins in CD-169). Registered with the people module's absence registry on start,
 * in the API and in the worker, so the approver rule sends a request to the Admins while the
 * manager is away. Runs in the caller's tenant transaction.
 */
@Injectable()
export class AbsenceService implements AbsenceSource, OnModuleInit {
  onModuleInit(): void {
    absenceRegistry.use(this);
  }

  async absentOn(tx: Tx, _tenantId: string, employeeIds: string[], date: string): Promise<Set<string>> {
    if (!employeeIds.length) return new Set();
    const rows = await tx
      .selectDistinct({ employeeId: timeoffRequestDays.employeeId })
      .from(timeoffRequestDays)
      .innerJoin(timeoffRequests, eq(timeoffRequests.id, timeoffRequestDays.requestId))
      .where(and(inArray(timeoffRequestDays.employeeId, employeeIds), eq(timeoffRequestDays.date, date), eq(timeoffRequestDays.state, 'counted'), eq(timeoffRequests.status, 'approved')));
    return new Set(rows.map((r) => r.employeeId));
  }
}
