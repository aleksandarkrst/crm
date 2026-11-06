import { and, asc, eq, inArray, lte, not, sql } from 'drizzle-orm';
import type { Tx } from '../../../shared/database/database.service';
import { type MeetingType, meetingReminders } from '../../../shared/database/schema';
import { defaultReminders, minutesOf, type Reminder, reminderOf } from './meeting-reminders';

/**
 * The meeting_reminders rows (CD-376), inside the caller's tenant transaction. A reminder whose
 * time has passed when it is saved is stored as sent for the meeting's start (`sent_for`), so it
 * never goes out late; the tick (MeetingJobs) sends the others once per start.
 */

type MeetingAt = { id: string; startsAt: Date };

const skippedFor = (m: MeetingAt, minutesBefore: number, now: Date): Date | null => (m.startsAt.getTime() - minutesBefore * 60_000 <= now.getTime() ? m.startsAt : null);

/** The defaults for people just added to the meeting (1 hour, and 1 day too for a visit). */
export async function addDefaultReminders(tx: Tx, tenantId: string, m: MeetingAt & { type: MeetingType }, userIds: readonly string[], now: Date): Promise<void> {
  const rows = userIds.flatMap((userId) =>
    defaultReminders(m.type).map((r) => ({ tenantId, meetingId: m.id, userId, minutesBefore: minutesOf(r), unit: r.unit, sentFor: skippedFor(m, minutesOf(r), now) })),
  );
  if (rows.length) await tx.insert(meetingReminders).values(rows).onConflictDoNothing();
}

/** People taken off the meeting lose their reminders of it. */
export async function removeReminders(tx: Tx, meetingId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length) await tx.delete(meetingReminders).where(and(eq(meetingReminders.meetingId, meetingId), inArray(meetingReminders.userId, [...userIds])));
}

/**
 * The meeting has a new start (moved, or restored after a cancellation): every reminder is due
 * again for it, except the ones whose time for it has already passed.
 */
export async function skipPastReminders(tx: Tx, m: MeetingAt, now: Date): Promise<void> {
  await tx
    .update(meetingReminders)
    .set({ sentFor: m.startsAt })
    .where(
      and(
        eq(meetingReminders.meetingId, m.id),
        sql`${meetingReminders.sentFor} is distinct from ${m.startsAt}::timestamptz`,
        lte(sql`${m.startsAt}::timestamptz - make_interval(mins => ${meetingReminders.minutesBefore})`, now),
      ),
    );
}

/** The caller's own reminders of these meetings, earliest first ("1 day" before "1 hour"). */
export async function remindersOf(tx: Tx, userId: string, meetingIds: readonly string[]): Promise<Map<string, Reminder[]>> {
  const out = new Map<string, Reminder[]>();
  if (!meetingIds.length) return out;
  const rows = await tx
    .select({ meetingId: meetingReminders.meetingId, minutesBefore: meetingReminders.minutesBefore, unit: meetingReminders.unit })
    .from(meetingReminders)
    .where(and(eq(meetingReminders.userId, userId), inArray(meetingReminders.meetingId, [...meetingIds])))
    .orderBy(asc(meetingReminders.meetingId), sql`${meetingReminders.minutesBefore} desc`);
  for (const r of rows) out.set(r.meetingId, [...(out.get(r.meetingId) ?? []), reminderOf(r.minutesBefore, r.unit)]);
  return out;
}

/**
 * Replaces one person's reminders of a meeting with `list` (checked by the caller). A reminder at
 * the same time stays as it was (sent or not), with the unit given; a new one whose time has
 * passed is stored as sent.
 */
export async function replaceReminders(tx: Tx, tenantId: string, m: MeetingAt, userId: string, list: readonly Reminder[], now: Date): Promise<void> {
  const mine = and(eq(meetingReminders.meetingId, m.id), eq(meetingReminders.userId, userId));
  const minutes = list.map(minutesOf);
  await tx.delete(meetingReminders).where(minutes.length ? and(mine, not(inArray(meetingReminders.minutesBefore, minutes))) : mine);
  for (const r of list) {
    const minutesBefore = minutesOf(r);
    await tx
      .insert(meetingReminders)
      .values({ tenantId, meetingId: m.id, userId, minutesBefore, unit: r.unit, sentFor: skippedFor(m, minutesBefore, now) })
      .onConflictDoUpdate({ target: [meetingReminders.meetingId, meetingReminders.userId, meetingReminders.minutesBefore], set: { unit: r.unit } });
  }
}
