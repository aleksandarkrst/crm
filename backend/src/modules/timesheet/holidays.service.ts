import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { publicHolidays } from '../../shared/database/schema';
import { holidayColumns, holidayDaysIn, type HolidayRule, holidayRules } from './timesheet-settings';
import type { CreateHoliday, UpdateHoliday } from './timesheet.schemas';

/** A holiday as the Holidays page shows it for one year (CD-318): that year's days of the rule. */
export interface HolidayView {
  id: string;
  /** The first day in the year asked for. */
  date: string;
  /** The last day in that year; the same as `date` for a single day. */
  endDate: string;
  name: string;
  /** Hours off in minutes; null is the whole standard day. */
  minutes: number | null;
  /** The year it was entered: it repeats from then on. */
  since: number;
}

const view = (rule: HolidayRule, days: string[]): HolidayView => ({ id: rule.id, date: days[0]!, endDate: days[days.length - 1]!, name: rule.name, minutes: rule.minutes, since: Number(rule.date.slice(0, 4)) });

/**
 * The workspace's public holidays (CD-153, Settings → Workforce → Holidays): any member reads them
 * (the Timesheet needs them); owners and admins add, change and remove them (the routes), each
 * in the audit log. A holiday is a day or a span of days that repeats every year from the year it
 * was entered (CD-318). One holiday per first day (`public_holidays_date_uq`, 409).
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** The holidays of `year`, first day first. */
  list(ctx: TenantContext, year: number): Promise<HolidayView[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rules = await holidayRules(tx);
      return rules
        .map((rule) => ({ rule, days: holidayDaysIn(rule, year) }))
        .filter((x) => x.days.length > 0)
        .map((x) => view(x.rule, x.days))
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  create(ctx: TenantContext, input: CreateHoliday): Promise<HolidayView> {
    const endDate = checkSpan(input.date, input.endDate ?? null);
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(publicHolidays)
          .values({ tenantId: ctx.tenantId, holidayDate: input.date, endDate, name: input.name, minutes: input.minutes ?? null })
          .returning(holidayColumns);
        await this.audit.record(tx, ctx, { action: 'holiday.created', entityType: 'holiday', entityId: row!.id, data: { ...input, endDate } });
        return view(row!, holidayDaysIn(row!, Number(row!.date.slice(0, 4))));
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateHoliday): Promise<HolidayView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [current] = await tx.select(holidayColumns).from(publicHolidays).where(eq(publicHolidays.id, id));
        if (!current) throw new NotFoundException('Holiday not found');
        const date = input.date ?? current.date;
        const endDate = checkSpan(date, input.endDate === undefined ? current.endDate : input.endDate);
        const [row] = await tx
          .update(publicHolidays)
          .set({ holidayDate: date, endDate, ...(input.name ? { name: input.name } : {}), ...(input.minutes !== undefined ? { minutes: input.minutes } : {}) })
          .where(eq(publicHolidays.id, id))
          .returning(holidayColumns);
        await this.audit.record(tx, ctx, { action: 'holiday.updated', entityType: 'holiday', entityId: id, data: { ...input } });
        return view(row!, holidayDaysIn(row!, Number(row!.date.slice(0, 4))));
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(publicHolidays).where(eq(publicHolidays.id, id)).returning(holidayColumns);
      if (!row) throw new NotFoundException('Holiday not found');
      await this.audit.record(tx, ctx, { action: 'holiday.deleted', entityType: 'holiday', entityId: id, data: { date: row.date, name: row.name } });
    });
  }
}

/** The last day of a span: null for a single day; never before the first day, never more than 60 days after it. */
function checkSpan(date: string, endDate: string | null): string | null {
  if (!endDate || endDate === date) return null;
  if (endDate < date) throw new BadRequestException('The holiday ends before it starts');
  if (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`) > 60 * 86_400_000) throw new BadRequestException('A holiday can span at most 60 days');
  return endDate;
}
