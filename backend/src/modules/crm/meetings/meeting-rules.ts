import type { MeetingNextStep, MeetingStatus, MembershipRole } from '../../../shared/database/schema';

/**
 * The rules of meetings (spec 4.3 and 10.1) as pure functions, so they are unit-tested on their
 * own: who may change a meeting, which status changes are allowed when, and "Not closed".
 */

/** A meeting still planned this long after its end is "Not closed" (amber, and in the digest). */
export const NOT_CLOSED_AFTER_MS = 24 * 60 * 60 * 1000;

/** Planned, and ended more than 24 hours ago. */
export const isNotClosed = (m: { status: MeetingStatus; endsAt: Date }, now: Date): boolean =>
  m.status === 'planned' && m.endsAt.getTime() < now.getTime() - NOT_CLOSED_AFTER_MS;

/**
 * Editing, rescheduling, cancelling and marking as held: owners and admins, the organizer, and the
 * internal participants. Everyone in the workspace can see meetings and create them; only owners
 * and admins delete them (the route requires the admin role).
 */
export function canManageMeeting(who: { role: MembershipRole; userId: string }, meeting: { organizerUserId: string | null; internalUserIds: readonly string[] }): boolean {
  if (who.role === 'owner' || who.role === 'admin') return true;
  return meeting.organizerUserId === who.userId || meeting.internalUserIds.includes(who.userId);
}

export type MeetingChange = 'edit' | 'held' | 'cancel' | 'undo-held' | 'restore';

/**
 * Why a change isn't allowed in the meeting's current state (a 409), or null when it is:
 * - planned → held: not before the meeting starts;
 * - planned → cancelled: any time;
 * - held → planned ("Undo held") and cancelled → planned ("Restore");
 * - a cancelled meeting is read-only until restored; a held one can still be corrected.
 */
export function meetingChangeError(change: MeetingChange, meeting: { status: MeetingStatus; startsAt: Date }, now: Date): string | null {
  const { status } = meeting;
  switch (change) {
    case 'edit':
      return status === 'cancelled' ? 'This meeting is cancelled. Restore it before changing it.' : null;
    case 'held':
      if (status === 'held') return 'This meeting is already marked as held.';
      if (status === 'cancelled') return 'This meeting is cancelled. Restore it first.';
      return meeting.startsAt.getTime() > now.getTime() ? "A meeting can't be marked as held before it starts." : null;
    case 'cancel':
      if (status === 'cancelled') return 'This meeting is already cancelled.';
      return status === 'held' ? "A held meeting can't be cancelled. Undo held first." : null;
    case 'undo-held':
      return status === 'held' ? null : 'Only a held meeting can be set back to planned.';
    case 'restore':
      return status === 'cancelled' ? null : 'Only a cancelled meeting can be restored.';
  }
}

/** A next step as the browser sends it: the task link is the server's to set. */
export type NextStepInput = Omit<MeetingNextStep, 'taskId'>;

/** A next step with its keys in one order, so two lists compare by value (JSON) whatever order jsonb stored them in. */
export const canonicalStep = (s: MeetingNextStep): MeetingNextStep => ({ id: s.id, text: s.text, ownerUserId: s.ownerUserId ?? null, dueDate: s.dueDate ?? null, taskId: s.taskId ?? null });

/**
 * The next steps after a save of the internal minutes (CD-132): the list sent replaces the list,
 * in its order, but each step keeps the task created from it (matched by step id). A step that
 * is removed takes its link along; the task itself stays on the deal.
 */
export function mergeNextSteps(sent: readonly NextStepInput[], existing: readonly MeetingNextStep[]): MeetingNextStep[] {
  const tasks = new Map(existing.map((s) => [s.id, s.taskId ?? null]));
  return sent.map((s) => canonicalStep({ ...s, taskId: tasks.get(s.id) ?? null }));
}

/** The owners a save sets anew (new steps, or another owner): they must be members. Unchanged ones may have left since. */
export function newStepOwners(next: readonly MeetingNextStep[], existing: readonly MeetingNextStep[]): string[] {
  const before = new Map(existing.map((s) => [s.id, s.ownerUserId ?? null]));
  return [...new Set(next.flatMap((s) => (s.ownerUserId && before.get(s.id) !== s.ownerUserId ? [s.ownerUserId] : [])))];
}
