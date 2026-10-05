/**
 * Meetings (CD-130): the store's meeting slice. Meetings aren't part of the workspace load (there
 * can be many); screens ask for the ones they show by a query (a date range and filters, or a
 * company, deal or contact) through `useMeetingList`, and every meeting read is kept by id in
 * `s.meetings`. A query's result is a list of ids in `s.meetingLists`, keyed by the query.
 *
 * Saving: the store's actions save and put the answer in the cache, then fix every loaded list
 * the meeting now belongs to (or no longer does) with `matchesQuery`, so the calendar, the cards
 * and the meeting page show the change at once.
 *
 * Live updates (CD-20): a `meeting` change hint names meeting ids; they are read again by `ids=`
 * and merged the same way (a meeting the API no longer returns was deleted). A hint without ids
 * re-runs every list on screen.
 *
 * Internal minutes (CD-132) are read per meeting into `s.meetingMinutes` when its minutes tab
 * opens. Their changes report the meeting (live hint `meeting`); its `minutesUpdatedAt` then
 * tells the open tab to read them again.
 */
import {
  type ApiInternalMinutes,
  type ApiMeeting,
  ApiError,
  type ApiRole,
  crmApi,
  type InternalMinutesInput,
  type MeetingInput,
  type MeetingQuery,
  type MeetingStatus,
  type MeetingType,
} from '../lib/api';
import type { LiveEvent } from './live';
import type { State } from './types';

export const MEETING_TYPES: { value: MeetingType; label: string; short: string }[] = [
  { value: 'visit', label: 'Customer visit', short: 'Visit' },
  { value: 'online', label: 'Online meeting', short: 'Online' },
  { value: 'office', label: 'Meeting at our office', short: 'Office' },
  { value: 'phone', label: 'Phone call', short: 'Call' },
];
export const TYPE_LABEL: Record<MeetingType, string> = { visit: 'Customer visit', online: 'Online meeting', office: 'Meeting at our office', phone: 'Phone call' };
export const STATUS_LABEL: Record<MeetingStatus, string> = { planned: 'Planned', held: 'Held', cancelled: 'Cancelled' };
export const MEETING_STATUSES: MeetingStatus[] = ['planned', 'held', 'cancelled'];
export const DEFAULT_STATUSES: MeetingStatus[] = ['planned', 'held'];
export const isMeetingType = (v: string): v is MeetingType => v in TYPE_LABEL;
export const isMeetingStatus = (v: string): v is MeetingStatus => v in STATUS_LABEL;

/** The result of a query: meeting ids in the API's order, and whether there were more. */
export interface MeetingList {
  query: MeetingQuery;
  ids: string[];
  more: boolean;
  loading: boolean;
  error: string | null;
}

/** What the New meeting dialog starts with; `id` edits that meeting instead. */
export interface MeetingDialogSeed {
  id?: string;
  companyId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  type?: MeetingType;
  organizerUserId?: string | null;
  /** ISO instant. */
  start?: string | null;
}

/** The key of a query (its fields in a fixed order), so equal queries share one list. */
export function meetingKey(q: MeetingQuery): string {
  const keys = Object.keys(q).sort() as (keyof MeetingQuery)[];
  return JSON.stringify(keys.filter((k) => q[k] !== undefined && q[k] !== false).map((k) => [k, q[k]]));
}

const startMs = (m: ApiMeeting) => Date.parse(m.startsAt);
const endMs = (m: ApiMeeting) => Date.parse(m.endsAt);
/** The organizer or an internal participant. */
export const isInternal = (m: ApiMeeting, userId: string): boolean => m.organizerUserId === userId || m.participants.some((p) => p.kind === 'internal' && p.userId === userId);
/** Planned and ended more than a day ago (the API says so too; this keeps it current on screen). */
export const isNotClosed = (m: ApiMeeting, now = Date.now()): boolean => m.status === 'planned' && endMs(m) < now - 86_400_000;

/** Whether a meeting belongs in a query's result, as the API decides it. */
export function matchesQuery(m: ApiMeeting, q: MeetingQuery, now = Date.now()): boolean {
  if (q.ids) return q.ids.includes(m.id);
  if (q.from && endMs(m) <= Date.parse(q.from)) return false;
  if (q.to && startMs(m) >= Date.parse(q.to)) return false;
  if (q.userId && !isInternal(m, q.userId)) return false;
  if (q.companyId && m.companyId !== q.companyId) return false;
  if (q.dealId && m.dealId !== q.dealId) return false;
  if (q.contactId && !m.participants.some((p) => p.kind === 'external' && p.contactId === q.contactId)) return false;
  if (q.type?.length && !q.type.includes(m.type)) return false;
  if (q.status?.length && !q.status.includes(m.status)) return false;
  if (q.notClosed && !isNotClosed(m, now)) return false;
  if (q.missingMinutes && !(m.status === 'held' && m.internalMinutes === 'missing')) return false;
  return true;
}

/** By start (then end, then title), as the API sorts them. */
export const byStart = (dir: 'asc' | 'desc' = 'asc') => (a: ApiMeeting, b: ApiMeeting) =>
  (dir === 'asc' ? 1 : -1) * (startMs(a) - startMs(b) || endMs(a) - endMs(b) || a.title.localeCompare(b.title));

/**
 * Edit, reschedule, cancel or mark as held: owners and admins, the organizer and internal
 * participants (spec 10.1). Creating is open to everyone; deleting is for owners and admins.
 */
export function canEditMeeting(m: ApiMeeting, me: string, role: ApiRole): boolean {
  return role === 'owner' || role === 'admin' || isInternal(m, me);
}

/** "No email" for contacts without a usable address (the lists show "—" for none). */
export const hasEmail = (email: string | null | undefined): boolean => !!email && /^[^\s@]+@[^\s@]+$/.test(email.trim());

/** A URL location is shown as a link. */
export const locationUrl = (location: string | null | undefined): string | null => {
  const v = location?.trim() ?? '';
  return /^https?:\/\/\S+$/i.test(v) ? v : /^www\.\S+$/i.test(v) ? 'https://' + v : null;
};

/** Open deals with a planned meeting still to come (they have a next step, CD-130). */
const upcomingCache = new WeakMap<Record<string, ApiMeeting>, { at: number; deals: Set<string> }>();
export function dealsWithUpcomingMeeting(meetings: Record<string, ApiMeeting>): Set<string> {
  const now = Date.now();
  const hit = upcomingCache.get(meetings);
  if (hit && now - hit.at < 60_000) return hit.deals;
  const deals = new Set<string>();
  for (const m of Object.values(meetings)) if (m.dealId && m.status === 'planned' && startMs(m) > now) deals.add(m.dealId);
  upcomingCache.set(meetings, { at: now, deals });
  return deals;
}

/** The planned meetings the store keeps loaded for "No next step": the coming year. */
export function upcomingQuery(): MeetingQuery {
  const now = new Date();
  const from = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000); // a stable key within the hour
  return { from: from.toISOString(), to: new Date(from.getTime() + 366 * 86_400_000).toISOString(), status: ['planned'], limit: 1000 };
}

// ---------------------------------------------------------------- the store's meeting actions

/** Mutable bookkeeping that outlives the store's action object (it is rebuilt on navigation). */
export interface MeetingRuntime {
  /** How many screens show each list. */
  watchers: Map<string, number>;
  /** Latest load per list, so an older answer never replaces a newer one. */
  seq: Map<string, number>;
  /** Meetings open on their own page (re-read on a hint without ids). */
  viewing: Map<string, number>;
  live: { ids: Set<string>; all: boolean; timer: ReturnType<typeof setTimeout> | undefined };
}
export const newMeetingRuntime = (): MeetingRuntime => ({ watchers: new Map(), seq: new Map(), viewing: new Map(), live: { ids: new Set(), all: false, timer: undefined } });

interface Ctx {
  cur: () => State;
  set: (u: Partial<State> | ((s: State) => Partial<State>)) => void;
  flash: (msg: string, ms?: number) => void;
  rt: MeetingRuntime;
  me: string;
  role: ApiRole;
  errText: (err: unknown) => string;
  conflictText: (err: unknown) => string | null;
  /** The deal's timeline (and last contact) changed on the server. */
  dealChanged: (dealId: string) => void;
  /** A task was added to the deal (a meeting's next step, CD-132): its tasks and timeline. */
  tasksChanged: (dealId: string) => void;
}

/** Puts fresh meetings in the cache and in (or out of) every loaded list; `gone` were deleted. */
function merge(s: State, fresh: ApiMeeting[], gone: readonly string[] = []): Partial<State> {
  const meetings = { ...s.meetings };
  for (const m of fresh) meetings[m.id] = m;
  for (const id of gone) delete meetings[id];
  const changed = new Set([...fresh.map((m) => m.id), ...gone]);
  const now = Date.now();
  const lists: Record<string, MeetingList> = {};
  for (const [key, list] of Object.entries(s.meetingLists)) {
    let ids = list.ids;
    let touched = false;
    for (const id of changed) {
      const m = meetings[id];
      const has = ids.includes(id);
      const fits = !!m && matchesQuery(m, list.query, now);
      if (has && !fits) {
        ids = ids.filter((x) => x !== id);
        touched = true;
      } else if (!has && fits) {
        ids = [...ids, id];
        touched = true;
      }
    }
    if (touched) {
      const sorted = ids.map((id) => meetings[id]!).sort(byStart(list.query.sort ?? 'asc'));
      const limit = list.query.limit;
      ids = sorted.slice(0, limit && limit < 50 ? limit : sorted.length).map((m) => m.id);
    }
    lists[key] = touched ? { ...list, ids } : list;
  }
  return { meetings, meetingLists: lists };
}

export function meetingActions(ctx: Ctx) {
  const { cur, set, flash, rt } = ctx;
  const put = (fresh: ApiMeeting[], gone: readonly string[] = []) => set((s) => merge(s, fresh, gone));

  /** Runs a list's query and shows its result. */
  const load = async (key: string, query: MeetingQuery) => {
    const seq = (rt.seq.get(key) ?? 0) + 1;
    rt.seq.set(key, seq);
    set((s) => ({ meetingLists: { ...s.meetingLists, [key]: { query, ids: s.meetingLists[key]?.ids ?? [], more: s.meetingLists[key]?.more ?? false, loading: true, error: null } } }));
    try {
      const res = await crmApi.meetings.list(query);
      if (rt.seq.get(key) !== seq || !rt.watchers.has(key)) return;
      set((s) => {
        const meetings = { ...s.meetings };
        for (const m of res.meetings) meetings[m.id] = m;
        return { meetings, meetingLists: { ...s.meetingLists, [key]: { query, ids: res.meetings.map((m) => m.id), more: res.more, loading: false, error: null } } };
      });
    } catch (err) {
      if (rt.seq.get(key) !== seq || !rt.watchers.has(key)) return;
      set((s) => ({ meetingLists: { ...s.meetingLists, [key]: { query, ids: s.meetingLists[key]?.ids ?? [], more: false, loading: false, error: ctx.errText(err) } } }));
    }
  };

  /** A screen shows this list: load it (again); the returned function says it is gone. */
  const watch = (key: string, query: MeetingQuery) => {
    rt.watchers.set(key, (rt.watchers.get(key) ?? 0) + 1);
    void load(key, query);
    return () => {
      const n = (rt.watchers.get(key) ?? 1) - 1;
      if (n > 0) return void rt.watchers.set(key, n);
      rt.watchers.delete(key);
      // Not on screen any more: forget the list (the meetings stay cached), so it loads fresh next time.
      set((s) => {
        const rest = { ...s.meetingLists };
        delete rest[key];
        return { meetingLists: rest };
      });
    };
  };

  /** Reads one meeting (its page); null when it doesn't exist. */
  const fetchOne = async (id: string): Promise<ApiMeeting | null> => {
    try {
      const m = await crmApi.meetings.get(id);
      put([m]);
      return m;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        put([], [id]);
        return null;
      }
      throw err;
    }
  };
  /** A meeting page is open (it reads the meeting with fetchOne): read it again after a missed hint. */
  const view = (id: string) => {
    rt.viewing.set(id, (rt.viewing.get(id) ?? 0) + 1);
    return () => {
      const n = (rt.viewing.get(id) ?? 1) - 1;
      if (n > 0) rt.viewing.set(id, n);
      else rt.viewing.delete(id);
    };
  };

  // ------------------------------------------------------------ live updates
  const runLive = async () => {
    const p = rt.live;
    const ids = [...p.ids];
    const all = p.all;
    p.ids.clear();
    p.all = false;
    try {
      if (all) {
        for (const [key] of rt.watchers) {
          const list = cur().meetingLists[key];
          if (list) void load(key, list.query);
        }
        const viewing = [...rt.viewing.keys()];
        for (let i = 0; i < viewing.length; i += 200) {
          const chunk = viewing.slice(i, i + 200);
          const res = await crmApi.meetings.list({ ids: chunk, limit: 1000 });
          put(res.meetings, chunk.filter((id) => !res.meetings.some((m) => m.id === id)));
        }
        return;
      }
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const res = await crmApi.meetings.list({ ids: chunk, limit: 1000 });
        put(res.meetings, chunk.filter((id) => !res.meetings.some((m) => m.id === id)));
      }
    } catch {
      // quiet: the next hint or the focus refresh catches up
    }
  };
  const onLive = (e: LiveEvent) => {
    const p = rt.live;
    if (!e.ids) p.all = true;
    else e.ids.forEach((id) => p.ids.add(id));
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void runLive(), 300);
  };
  /** Everything on screen, after the stream was down or on focus. */
  const refreshAll = () => onLive({ type: 'meeting', ids: null });

  // ------------------------------------------------------------ saving
  /** Writes that change a deal's timeline refresh it (this tab doesn't get its own change hints). */
  const after = (m: ApiMeeting, dealIds: (string | null | undefined)[] = []) => {
    put([m]);
    for (const id of new Set([m.dealId, ...dealIds])) if (id) ctx.dealChanged(id);
    return m;
  };
  /** New meeting; throws with the API's reason (the dialog shows it). */
  const create = async (input: MeetingInput & { title: string; type: MeetingType; startsAt: string; endsAt: string; companyId: string }) => after(await crmApi.meetings.create(input));
  /** Saves the dialog's changes (If-Match: the version the dialog started from); throws on failure. */
  const update = async (id: string, input: MeetingInput, version?: string) => {
    const before = cur().meetings[id];
    try {
      return after(await crmApi.meetings.patch(id, input, version), [before?.dealId]);
    } catch (err) {
      const conflict = ctx.conflictText(err);
      if (conflict) void fetchOne(id).catch(() => undefined);
      throw conflict ? new Error(conflict) : err;
    }
  };
  /** Drag to another time or day, or a new end (calendar). Shown at once; put back if refused. */
  const reschedule = async (id: string, startsAt: string, endsAt: string) => {
    const m = cur().meetings[id];
    if (!m) return;
    put([{ ...m, startsAt, endsAt }]);
    try {
      after(await crmApi.meetings.patch(id, { startsAt, endsAt }, m.updatedAt));
    } catch (err) {
      const conflict = ctx.conflictText(err);
      flash(conflict ?? `Not saved: the new time of "${m.title}" (${ctx.errText(err)}). It was put back.`, conflict ? 10_000 : 7000);
      put([m]);
      void fetchOne(id).catch(() => undefined);
    }
  };
  /** A status change from the meeting page; false (after saying why) when it was refused. */
  const status = async (id: string, write: () => Promise<ApiMeeting>, done: string): Promise<boolean> => {
    try {
      after(await write());
      flash(done);
      return true;
    } catch (err) {
      flash('Not saved: ' + ctx.errText(err), 7000);
      void fetchOne(id).catch(() => undefined);
      return false;
    }
  };
  const remove = async (id: string): Promise<boolean> => {
    const m = cur().meetings[id];
    try {
      await crmApi.meetings.delete(id);
    } catch (err) {
      flash('Not deleted: ' + ctx.errText(err), 7000);
      return false;
    }
    put([], [id]);
    if (m?.dealId) ctx.dealChanged(m.dealId);
    flash(`${m?.title ?? 'The meeting'} deleted`);
    return true;
  };

  // ------------------------------------------------------------ internal minutes (CD-132)
  const minutesLoaded = (id: string, minutes: ApiInternalMinutes) => {
    set((s) => ({ meetingMinutes: { ...s.meetingMinutes, [id]: minutes } }));
    // The meeting's "Recorded"/"Missing" and version follow at once (lists, the calendar table).
    const m = cur().meetings[id];
    const internalMinutes = minutes.summary.trim() ? 'recorded' : 'missing';
    if (m && (m.minutesUpdatedAt !== minutes.updatedAt || m.internalMinutes !== internalMinutes)) put([{ ...m, internalMinutes, minutesUpdatedAt: minutes.updatedAt }]);
  };
  /** Reads a meeting's internal minutes; throws when they can't be read. */
  const loadMinutes = async (id: string): Promise<ApiInternalMinutes> => {
    const minutes = await crmApi.meetings.minutes(id);
    minutesLoaded(id, minutes);
    return minutes;
  };
  /**
   * Saves parts of the minutes, based on `version` (what the editor started from). Returns the
   * saved minutes; `{ conflict }` when someone else changed the same part (the message is shown,
   * and `conflict` is the minutes read again, null if that failed); null for another failure (shown).
   */
  const saveMinutes = async (id: string, input: InternalMinutesInput, version: string | null): Promise<{ saved: ApiInternalMinutes } | { conflict: ApiInternalMinutes | null } | null> => {
    try {
      const saved = await crmApi.meetings.saveMinutes(id, input, version);
      minutesLoaded(id, saved);
      return { saved };
    } catch (err) {
      const conflict = ctx.conflictText(err);
      flash(conflict ?? `Not saved: the minutes (${ctx.errText(err)}).`, conflict ? 10_000 : 7000);
      if (!conflict) return null;
      return { conflict: await loadMinutes(id).catch(() => null) };
    }
  };
  /** "Create task" on a next step: a task on the meeting's deal. null (after saying why) when refused. */
  const createStepTask = async (id: string, stepId: string) => {
    try {
      const res = await crmApi.meetings.stepTask(id, stepId);
      minutesLoaded(id, res.minutes);
      ctx.tasksChanged(res.task.dealId);
      flash('Task created on the deal');
      return res;
    } catch (err) {
      flash('Task not created: ' + ctx.errText(err), 7000);
      if (err instanceof ApiError && err.status === 409) void loadMinutes(id).catch(() => undefined);
      return null;
    }
  };

  /**
   * Other meetings of these members that overlap the time (the dialog's warning, spec 4.4). It
   * never blocks saving.
   */
  const findOverlaps = async (userIds: string[], startsAt: string, endsAt: string, excludeId?: string): Promise<{ userId: string; meeting: ApiMeeting }[]> => {
    const out: { userId: string; meeting: ApiMeeting }[] = [];
    await Promise.all(
      [...new Set(userIds)].map(async (userId) => {
        const res = await crmApi.meetings.list({ from: startsAt, to: endsAt, userId, status: ['planned', 'held'], limit: 5 });
        const other = res.meetings.find((m) => m.id !== excludeId);
        if (other) out.push({ userId, meeting: other });
      }),
    );
    return out.sort((a, b) => userIds.indexOf(a.userId) - userIds.indexOf(b.userId));
  };

  return {
    watch,
    view,
    fetchOne,
    onLive,
    refreshAll,
    create,
    update,
    reschedule,
    markHeld: (id: string) => status(id, () => crmApi.meetings.held(id), 'Marked as held'),
    cancel: (id: string, reason: string) => status(id, () => crmApi.meetings.cancel(id, reason.trim() || null), 'Meeting cancelled'),
    undoHeld: (id: string) => status(id, () => crmApi.meetings.undoHeld(id), 'Back to planned'),
    restore: (id: string) => status(id, () => crmApi.meetings.restore(id), 'Meeting restored'),
    remove,
    findOverlaps,
    loadMinutes,
    saveMinutes,
    createStepTask,
    /** Opens the New meeting dialog (prefilled), or the dialog editing a meeting (`seed.id`). */
    openDialog: (seed: MeetingDialogSeed = {}) => set({ meetingDialog: seed }),
    closeDialog: () => set({ meetingDialog: null }),
    canEdit: (m: ApiMeeting) => canEditMeeting(m, ctx.me, ctx.role),
    /** Only owners and admins delete meetings. */
    canDelete: ctx.role === 'owner' || ctx.role === 'admin',
  };
}
export type MeetingActions = ReturnType<typeof meetingActions>;
