import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, between, eq } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { publicHolidays } from '../../shared/database/schema';
import type { CreateHoliday, UpdateHoliday } from './timesheet.schemas';

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  /** Hours off in minutes; null is the whole standard day. */
  minutes: number | null;
}

const columns = { id: publicHolidays.id, date: publicHolidays.holidayDate, name: publicHolidays.name, minutes: publicHolidays.minutes };
const yearRange = (year: number) => [`${year}-01-01`, `${year}-12-31`] as const;

/**
 * The workspace's public holidays (CD-153, Settings → Workforce → Holidays): any member reads them
 * (the Timesheet needs them); owners and admins add, change and remove them (the routes), each
 * in the audit log. One holiday per date (`public_holidays_date_uq`, 409).
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: TenantContext, year: number): Promise<HolidayView[]> {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select(columns)
        .from(publicHolidays)
        .where(between(publicHolidays.holidayDate, ...yearRange(year)))
        .orderBy(asc(publicHolidays.holidayDate)),
    );
  }

  create(ctx: TenantContext, input: CreateHoliday): Promise<HolidayView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(publicHolidays)
          .values({ tenantId: ctx.tenantId, holidayDate: input.date, name: input.name, minutes: input.minutes ?? null })
          .returning(columns);
        await this.audit.record(tx, ctx, { action: 'holiday.created', entityType: 'holiday', entityId: row!.id, data: { ...input } });
        return row!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateHoliday): Promise<HolidayView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .update(publicHolidays)
          .set({ ...(input.date ? { holidayDate: input.date } : {}), ...(input.name ? { name: input.name } : {}), ...(input.minutes !== undefined ? { minutes: input.minutes } : {}) })
          .where(eq(publicHolidays.id, id))
          .returning(columns);
        if (!row) throw new NotFoundException('Holiday not found');
        await this.audit.record(tx, ctx, { action: 'holiday.updated', entityType: 'holiday', entityId: id, data: { ...input } });
        return row;
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(publicHolidays).where(eq(publicHolidays.id, id)).returning(columns);
      if (!row) throw new NotFoundException('Holiday not found');
      await this.audit.record(tx, ctx, { action: 'holiday.deleted', entityType: 'holiday', entityId: id, data: { date: row.date, name: row.name } });
    });
  }

  /**
   * Copy from last year: each of last year's holidays on the same day and month of `year` (fixed
   * dates), only where `year` has none yet; 29 February only into a leap year. Answers the year.
   */
  copyFromLastYear(ctx: TenantContext, year: number): Promise<{ copied: number; holidays: HolidayView[] }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const last = await tx
        .select(columns)
        .from(publicHolidays)
        .where(between(publicHolidays.holidayDate, ...yearRange(year - 1)));
      const rows = last.flatMap((h) => {
        const date = `${year}${h.date.slice(4)}`;
        return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? [{ tenantId: ctx.tenantId, holidayDate: date, name: h.name, minutes: h.minutes }] : [];
      });
      const copied = rows.length ? await tx.insert(publicHolidays).values(rows).onConflictDoNothing().returning({ id: publicHolidays.id }) : [];
      if (copied.length) await this.audit.record(tx, ctx, { action: 'holiday.copied', entityType: 'holiday', data: { year, copied: copied.length } });
      const holidays = await tx
        .select(columns)
        .from(publicHolidays)
        .where(and(between(publicHolidays.holidayDate, ...yearRange(year))))
        .orderBy(asc(publicHolidays.holidayDate));
      return { copied: copied.length, holidays };
    });
  }
}
