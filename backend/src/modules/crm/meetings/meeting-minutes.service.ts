import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { deals, dealTasks, type MeetingNextStep, meetingMinutes, meetings, memberships } from '../../../shared/database/schema';
import { nonEmptyPatch } from '../../../shared/validation/common';
import { DealTasksService } from '../deals/deal-tasks.service';
import { RecordHistoryService } from '../history/record-history.service';
import { userNameOf } from '../owner';
import { canonicalStep, mergeNextSteps, newStepOwners } from './meeting-rules';
import { MeetingsService } from './meetings.service';

/** Limits of the internal minutes (spec 6.1). */
export const SUMMARY_MAX = 10_000;
export const AGREEMENTS_MAX = 5_000;
export const NEXT_STEP_MAX = 500;
export const NEXT_STEPS_MAX = 50;
/** A deal task's title is at most this long (DealTasksService): longer steps are shortened. */
const TASK_TITLE_MAX = 200;

const NextStep = z.object({
  /** Made by the browser, so a step keeps its identity (and its task) across saves. */
  id: z.uuid(),
  /** May be empty while someone is still typing it; a task needs text. */
  text: z.string().trim().max(NEXT_STEP_MAX),
  /** Must be a member of the workspace. */
  ownerUserId: z.uuid().nullish().transform((v) => v ?? null),
  dueDate: z.iso
    .date()
    .nullish()
    .transform((v) => v ?? null),
});

/**
 * A save of the internal minutes: the fields sent replace the stored ones (the text is kept as
 * written; only blank text becomes empty). `nextSteps` replaces the list; each step keeps its task.
 */
export const SaveInternalMinutes = nonEmptyPatch(
  z.object({
    summary: z.string().max(SUMMARY_MAX).nullish(),
    agreements: z.string().max(AGREEMENTS_MAX).nullish(),
    nextSteps: z
      .array(NextStep)
      .max(NEXT_STEPS_MAX)
      .refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, { message: 'Each next step needs its own id' })
      .optional(),
  }),
);
export type SaveInternalMinutes = z.infer<typeof SaveInternalMinutes>;

export interface ApiInternalMinutes {
  summary: string;
  agreements: string;
  nextSteps: MeetingNextStep[];
  /** The version (If-Match); null before anyone wrote the minutes. */
  updatedAt: Date | null;
  updatedByName: string | null;
}

const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v);

/**
 * The internal minutes of a meeting (CD-132): summary, agreements and next steps. Every member
 * reads them; the people who may change the meeting write them (organizer, internal participants,
 * admins, owners), while it is planned or held: a cancelled meeting is read-only. They are never
 * part of an email to a customer: the external minutes (CD-133) are a separate text.
 *
 * Saving with If-Match (the minutes' updatedAt; the epoch when there were none yet) refuses a
 * field someone else changed since, with the usual conflict message: the minutes' changes are
 * history rows of the meeting (drizzle/0031_meeting_minutes_rls.sql).
 */
@Injectable()
export class MeetingMinutesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly meetings: MeetingsService,
    private readonly tasks: DealTasksService,
    private readonly changes: RecordHistoryService,
  ) {}

  /** Empty minutes when nobody wrote any yet; 404 for an unknown meeting. */
  getInternal(ctx: TenantContext, meetingId: string): Promise<ApiInternalMinutes> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [meeting] = await tx.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, meetingId));
      if (!meeting) throw new NotFoundException('Meeting not found');
      return this.load(tx, meetingId);
    });
  }

  saveInternal(ctx: TenantContext, meetingId: string, input: SaveInternalMinutes, version?: Date): Promise<ApiInternalMinutes> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.meetings.lockForChange(tx, ctx, meetingId, 'edit');
        const current = await this.lockMinutes(tx, meetingId);
        const existing = current?.nextSteps ?? [];
        const nextSteps = input.nextSteps ? mergeNextSteps(input.nextSteps, existing) : undefined;
        if (nextSteps) await this.assertMembers(tx, ctx, newStepOwners(nextSteps, existing));

        const patch = { summary: blankToNull(input.summary), agreements: blankToNull(input.agreements), nextSteps };
        const fields = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        if (current && version) {
          const stored = { id: meetingId, updatedAt: current.updatedAt, summary: current.summary, agreements: current.agreements, nextSteps: existing.map(canonicalStep) };
          await this.changes.assertNoConflict(tx, ctx, 'meeting', stored, fields, version);
        }
        if (current) await tx.update(meetingMinutes).set({ ...fields, updatedByUserId: ctx.userId }).where(eq(meetingMinutes.id, current.id));
        else await tx.insert(meetingMinutes).values({ ...fields, tenantId: ctx.tenantId, meetingId, updatedByUserId: ctx.userId });
        await this.audit.record(tx, ctx, { action: 'meeting.minutes_updated', entityType: 'meeting', entityId: meetingId, data: { fields: Object.keys(fields) } });
        return this.load(tx, meetingId);
      })
      .catch(mapDbError);
  }

  /**
   * "Create task" on a next step: a task on the meeting's deal, in its current stage, as the "New
   * task" dialog makes them (no stage gate, channel Meeting, "Task added" on the timeline), with
   * the step's text, owner (or the caller) and due date. The step then links to it. 409 without a
   * deal, or when the step already has a task that still exists.
   */
  createTask(ctx: TenantContext, meetingId: string, stepId: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const meeting = await this.meetings.lockForChange(tx, ctx, meetingId, 'edit');
        if (!meeting.dealId) throw new ConflictException('Link a deal to this meeting to create tasks from its next steps.');
        const current = await this.lockMinutes(tx, meetingId);
        const step = current?.nextSteps.find((s) => s.id === stepId);
        if (!current || !step) throw new NotFoundException('Next step not found');
        if (step.taskId) {
          const [task] = await tx.select({ id: dealTasks.id }).from(dealTasks).where(eq(dealTasks.id, step.taskId));
          if (task) throw new ConflictException('This next step already has a task.');
        }
        const text = step.text.trim();
        if (!text) throw new BadRequestException('Write the next step before creating a task from it.');
        const [deal] = await tx.select({ stageId: deals.stageId }).from(deals).where(eq(deals.id, meeting.dealId));
        if (!deal) throw new ConflictException('Link a deal to this meeting to create tasks from its next steps.');

        const task = await this.tasks.insertExtra(tx, ctx, meeting.dealId, {
          stageId: deal.stageId,
          label: text.length > TASK_TITLE_MAX ? text.slice(0, TASK_TITLE_MAX - 1) + '…' : text,
          blocksAdvance: false,
          channel: 'MT',
          dueDate: step.dueDate,
          assigneeUserId: step.ownerUserId ?? ctx.userId,
        });
        const nextSteps = current.nextSteps.map((s) => canonicalStep(s.id === stepId ? { ...s, taskId: task.id } : s));
        await tx.update(meetingMinutes).set({ nextSteps, updatedByUserId: ctx.userId }).where(eq(meetingMinutes.id, current.id));
        await this.audit.record(tx, ctx, { action: 'meeting.next_step_task', entityType: 'meeting', entityId: meetingId, data: { stepId, taskId: task.id } });
        return { minutes: await this.load(tx, meetingId), task };
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ helpers

  private async lockMinutes(tx: Tx, meetingId: string) {
    const [row] = await tx.select().from(meetingMinutes).where(eq(meetingMinutes.meetingId, meetingId)).for('update');
    return row;
  }

  private async assertMembers(tx: Tx, ctx: TenantContext, userIds: string[]) {
    if (!userIds.length) return;
    const found = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.userId, userIds)));
    if (found.length !== userIds.length) throw new BadRequestException('The owner of a next step must be a member of this workspace');
  }

  private async load(tx: Tx, meetingId: string): Promise<ApiInternalMinutes> {
    const [row] = await tx
      .select({
        summary: meetingMinutes.summary,
        agreements: meetingMinutes.agreements,
        nextSteps: meetingMinutes.nextSteps,
        updatedAt: meetingMinutes.updatedAt,
        updatedByName: userNameOf(meetingMinutes.updatedByUserId),
      })
      .from(meetingMinutes)
      .where(eq(meetingMinutes.meetingId, meetingId));
    if (!row) return { summary: '', agreements: '', nextSteps: [], updatedAt: null, updatedByName: null };
    return { ...row, summary: row.summary ?? '', agreements: row.agreements ?? '', nextSteps: row.nextSteps.map(canonicalStep) };
  }
}
