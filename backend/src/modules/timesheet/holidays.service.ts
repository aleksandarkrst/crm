import { JobsService } from '../../shared/events/jobs.service';
import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { type HolidaySource, publicHolidayPreloads, publicHolidays, tenants } from '../../shared/database/schema';
import { TenantProvisioning, type TenantProvisioner } from '../../shared/events/tenant-provisioning';
import { zonedParts } from '../../shared/time/zoned-time';
import { serbianHolidays } from './serbian-holidays';
import { holidayColumns, holidayDaysIn, type HolidayRule, holidayRules } from './timesheet-settings';
import type { CreateHoliday, HolidayPreloadInput, UpdateHoliday } from './timesheet.schemas';

/** Whose holidays a workspace preloads (spec 4.3). */
export type HolidayCountry = 'none' | 'serbia';

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
  /** The year it was entered: it repeats from then on, or holds in that year only. */
  since: number;
  repeats: boolean;
  source: HolidaySource;
}

const view = (rule: HolidayRule, days: string[]): HolidayView => ({ id: rule.id, date: days[0]!, endDate: days[days.length - 1]!, name: rule.name, minutes: rule.minutes, since: Number(rule.date.slice(0, 4)), repeats: rule.repeats, source: rule.source });

/**
 * The workspace's public holidays (CD-153, Settings → Workforce → Holidays): any member reads them
 * (the Timesheet needs them); owners and admins add, change and remove them (the routes), each
 * in the audit log. A holiday is a day or a span of days that repeats every year from the year it
 * was entered (CD-318). One holiday per first day (`public_holidays_date_uq`, 409).
 */
@Injectable()
export class HolidaysService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
    private readonly jobs: JobsService,
  ) {}

  /** Absence lines follow the calendar (CD-170): this year and the next, for everyone with absences then. */
  private resyncAbsences(tx: Tx, tenantId: string): Promise<void> {
    const year = new Date().getUTCFullYear();
    return this.jobs.send('timeoff.sync-timesheet', { tenantId, from: `${year}-01-01`, to: `${year + 1}-12-31` }, tx);
  }

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  /** A new workspace preloads Serbia's holidays for this year and the next (spec 4.3). */
  async provision(tx: Tx, tenantId: string): Promise<void> {
    await tx.update(tenants).set({ holidayPreload: 'serbia' }).where(eq(tenants.id, tenantId));
    const year = new Date().getUTCFullYear();
    await this.preloadIn(tx, tenantId, 'serbia', [year, year + 1]);
  }

  // ---------------------------------------------------------------- preload (spec 4.3)

  /** The workspace's setting and the years already generated. */
  preloadState(ctx: TenantContext): Promise<{ country: HolidayCountry; years: number[] }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [t] = await tx.select({ country: tenants.holidayPreload }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      const years = (await tx.select({ year: publicHolidayPreloads.year }).from(publicHolidayPreloads).orderBy(publicHolidayPreloads.year)).map((r) => r.year);
      return { country: (t?.country ?? 'none') as HolidayCountry, years };
    });
  }

  /**
   * Sets the country (Admins) and preloads this year and the next at once (or one `year`); with
   * "None" the calendar is left as it is. A year is generated once: later edits are never overwritten.
   */
  setPreload(ctx: TenantContext, input: HolidayPreloadInput): Promise<{ country: HolidayCountry; years: number[]; added: number }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await tx.update(tenants).set({ holidayPreload: input.country }).where(eq(tenants.id, ctx.tenantId));
      const year = new Date().getUTCFullYear();
      const added = input.country === 'none' ? 0 : await this.preloadIn(tx, ctx.tenantId, input.country, input.year ? [input.year] : [year, year + 1]);
      await this.audit.record(tx, ctx, { action: 'holiday.preload', entityType: 'holiday', data: { ...input, added } });
      const years = (await tx.select({ year: publicHolidayPreloads.year }).from(publicHolidayPreloads).orderBy(publicHolidayPreloads.year)).map((r) => r.year);
      return { country: input.country, years, added };
    });
  }

  /** The daily job: a workspace with a country gets this year and, from 1 November, next year (spec 4.3, 4.4), each once. */
  async ensurePreloaded(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [t] = await tx.select({ country: tenants.holidayPreload, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
      if (!t || t.country === 'none') return 0;
      const today = zonedParts(now, t.timezone).date;
      const year = Number(today.slice(0, 4));
      return this.preloadIn(tx, tenantId, t.country as HolidayCountry, today.slice(5) >= '11-01' ? [year, year + 1] : [year]);
    });
  }

  /**
   * Adds the country's days of `years` that the calendar doesn't have yet (a repeating holiday
   * entered earlier already covers its day) and records each year as generated. Answers how many
   * entries were added.
   */
  private async preloadIn(tx: Tx, tenantId: string, country: HolidayCountry, years: number[]): Promise<number> {
    if (country === 'none') return 0;
    let added = 0;
    for (const year of years) {
      const [done] = await tx.select({ year: publicHolidayPreloads.year }).from(publicHolidayPreloads).where(and(eq(publicHolidayPreloads.tenantId, tenantId), eq(publicHolidayPreloads.year, year)));
      if (done) continue;
      const rules = await holidayRules(tx);
      const covered = new Set<string>();
      for (const rule of rules) for (const d of holidayDaysIn(rule, year)) covered.add(d);
      for (const h of serbianHolidays(year)) {
        if (covered.has(h.date)) continue;
        const inserted = await tx
          .insert(publicHolidays)
          .values({ tenantId, holidayDate: h.date, endDate: h.endDate, name: h.name, minutes: null, repeats: h.repeats, source: 'preload' })
          .onConflictDoNothing()
          .returning({ id: publicHolidays.id });
        added += inserted.length;
      }
      await tx.insert(publicHolidayPreloads).values({ tenantId, year, country }).onConflictDoNothing();
    }
    return added;
  }

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
        await this.resyncAbsences(tx, ctx.tenantId);
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
        await this.resyncAbsences(tx, ctx.tenantId);
        return view(row!, holidayDaysIn(row!, Number(row!.date.slice(0, 4))));
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(publicHolidays).where(eq(publicHolidays.id, id)).returning(holidayColumns);
      if (!row) throw new NotFoundException('Holiday not found');
      await this.audit.record(tx, ctx, { action: 'holiday.deleted', entityType: 'holiday', entityId: id, data: { date: row.date, name: row.name } });
      await this.resyncAbsences(tx, ctx.tenantId);
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
