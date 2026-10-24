import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FilterRow } from '../components/FilterRow';
import { Screen } from '../components/Layout';
import { XIcon } from '../components/ui';
import type { ApiMeeting, MeetingQuery, MeetingStatus } from '../lib/api';
import { paths } from '../lib/paths';
import { filterPeople, meetingFields } from '../store/filterFields';
import { applyFilters, type FieldFilter, type FilterValue } from '../store/filters';
import { DEFAULT_STATUSES, isMeetingStatus, isMeetingType, MEETING_STATUSES, MEETING_TYPES } from '../store/meetings';
import { allPeople } from '../store/selectors';
import { useStore } from '../store/store';
import { usePageFilters } from '../store/usePageFilters';
import { addDays, addMonths, dateLabel, datesBetween, datesRange, dayRange, daysBetween, instantToZoned, isIsoDate, monthGridRange, monthLabel, monthRange, todayIn, weekRange, zonedToInstant } from '../store/time';
import { useMeetingList } from '../store/useMeetings';
import { MAX_LINK_IDS } from '../store/visitPlans';
import { DayList } from './calendar/DayList';
import { MeetingTable } from './calendar/MeetingTable';
import { MonthGrid } from './calendar/MonthGrid';
import { QuickCreate } from './calendar/QuickCreate';
import { type CalendarDraft, TimeGrid } from './calendar/TimeGrid';

type View = 'day' | 'week' | 'month' | 'table';
const VIEWS: { value: View; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'table', label: 'Table' },
];
/** Rows per page of the Table view ("Load more" fetches the next). */
const TABLE_PAGE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A prefilled New meeting page from the URL (`?new=1&companyId=…`), read once and removed. */
const NEW_PARAMS = ['new', 'companyId', 'dealId', 'contactId', 'type', 'organizer', 'start'];
/** The filter row's chips a link can set (a report, a record's "Show all"): read into the row, then removed. */
const LINK_FILTERS = ['user', 'type', 'status', 'company'];
const COMPANY = 'company.company';
const DEFAULTS: FilterValue = { order: ['owner', 'type', 'status'], f: { owner: { op: 'is', vals: [] }, type: { op: 'is', vals: [] }, status: { op: 'is', vals: [...DEFAULT_STATUSES] } } };

/** A link's filters as the row: everything it names, the defaults for the rest (Status), nothing else. */
function linkFilters(params: URLSearchParams, me: string): FilterValue {
  const user = params.get('user') ?? 'all';
  const company = params.get('company');
  const v: FilterValue = {
    order: [...DEFAULTS.order, ...(company ? [COMPANY] : [])],
    f: {
      owner: { op: 'is', vals: user === 'all' ? [] : [user === 'me' ? me : user] },
      type: { op: 'is', vals: (params.get('type') ?? '').split(',').filter(isMeetingType) },
      status: { op: 'is', vals: params.has('status') ? (params.get('status') ?? '').split(',').filter(isMeetingStatus) : [...DEFAULT_STATUSES] },
    },
  };
  if (company) v.f[COMPANY] = { op: 'is', vals: [company] };
  return v;
}

/** What a list chip lets through of `all`: null when it doesn't filter (Any). */
function picked<T extends string>(all: readonly T[], v: FieldFilter | undefined): T[] | null {
  if (!v?.vals?.length) return null;
  return v.op === 'isnot' ? all.filter((x) => !v.vals!.includes(x)) : all.filter((x) => v.vals!.includes(x));
}

/** True on phones (≤700px, as the CSS): Day opens by default and Week becomes a list. */
function usePhone(): boolean {
  const query = '(max-width: 700px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * The Calendar (CD-130): every meeting in Day, Week, Month and Table views. The view and the period
 * live in the URL; the filter row (CD-366) is remembered per person like on the other pages, and a
 * link's filters (`user`, `type`, `status`, `company`) are read into it for that visit. Switching
 * views keeps the filters and the period. Times are in the workspace time zone.
 *
 * Making a meeting (CD-212): on Day and Week, a click or a drag over empty slots draws a
 * placeholder and opens the quick-create popover next to it; on Month, a click on a day opens it
 * at 09:00. On phones a tap opens the New meeting page (CD-221).
 */
export function Calendar() {
  const store = useStore();
  const { s, session, meetings: actions } = store;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const tz = s.workspace.timezone;
  const today = todayIn(tz);
  const me = session.userId;

  // ------------------------------------------------------------ state from the URL
  // `ids=…`: exactly these meetings (a report's or plan's number, CD-211), in the table, whatever the filters.
  const idsParam = params.get('ids') ?? '';
  const idList = useMemo(() => {
    const list = idsParam.split(',').filter((id) => UUID.test(id));
    return list.length ? [...new Set(list)].slice(0, MAX_LINK_IDS) : null;
  }, [idsParam]);
  const reportCount = Number(params.get('report')) || 0;
  const raw = params.get('view');
  const view: View = idList ? 'table' : raw === 'day' || raw === 'week' || raw === 'month' || raw === 'table' ? raw : phone ? 'day' : 'week';
  const date = isIsoDate(params.get('date')) ? params.get('date')! : today;
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const tableFrom = isIsoDate(fromParam) ? fromParam : monthRange(date, tz).first;
  const tableTo = isIsoDate(toParam) && toParam >= tableFrom ? toParam : isIsoDate(fromParam) ? addDays(tableFrom, 30) : monthRange(date, tz).last;
  const fromLink = LINK_FILTERS.some((k) => params.has(k));
  const [filters, setFilters] = usePageFilters('calendar', DEFAULTS, fromLink ? linkFilters(params, me) : undefined);
  const fields = useMemo(() => meetingFields(s), [s]);
  // What the API filters on: one salesperson, the types and statuses let through, one company.
  const owners = filters.f.owner?.vals ?? [];
  const user = owners.length === 1 ? owners[0]! : null;
  const types = picked(MEETING_TYPES.map((t) => t.value), filters.f.type);
  const statuses = picked<MeetingStatus>(MEETING_STATUSES, filters.f.status);
  const companyFilter = filters.f[COMPANY];
  const company = filters.order.includes(COMPANY) && companyFilter?.op !== 'isnot' && companyFilter?.vals?.length === 1 ? companyFilter.vals[0]! : '';
  const deal = params.get('deal') ?? '';
  const contact = params.get('contact') ?? '';
  const notClosed = params.get('notClosed') === '1';
  const missingMinutes = params.get('missingMinutes') === '1';
  const sort = params.get('sort') === 'desc' ? 'desc' : 'asc';

  /** Changes some URL parameters (null removes one), keeping the others. */
  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // ?new=1&companyId=…: open the prefilled New meeting page (from links), once.
  const openDialog = actions.openDialog;
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const type = params.get('type');
    openDialog({
      companyId: params.get('companyId'),
      dealId: params.get('dealId'),
      contactId: params.get('contactId'),
      type: type && isMeetingType(type) ? type : undefined,
      organizerUserId: params.get('organizer'),
      start: params.get('start'),
    });
    update(Object.fromEntries(NEW_PARAMS.map((k) => [k, null])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the URL asks for it
  }, [params]);

  // A link's filters: into the row for this visit (not remembered), and out of the URL.
  useEffect(() => {
    if (!LINK_FILTERS.some((k) => params.has(k))) return;
    setFilters(linkFilters(params, me), false);
    update(Object.fromEntries(LINK_FILTERS.map((k) => [k, null])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the URL asks for it
  }, [params]);

  // ------------------------------------------------------------ the period on screen
  const range = useMemo(() => {
    if (view === 'day') return dayRange(date, tz);
    if (view === 'week') return weekRange(date, tz);
    if (view === 'month') return monthGridRange(date, tz);
    return datesRange(tableFrom, tableTo, tz);
  }, [view, date, tableFrom, tableTo, tz]);
  const days = useMemo(() => (view === 'table' ? [] : datesBetween(range.first, range.last)), [view, range]);

  const filtered: MeetingQuery = {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    userId: user ?? undefined,
    companyId: company || undefined,
    dealId: deal || undefined,
    contactId: contact || undefined,
    type: types ?? undefined,
    status: statuses ?? undefined,
    notClosed: view === 'table' && notClosed ? true : undefined,
    missingMinutes: view === 'table' && missingMinutes ? true : undefined,
    sort: view === 'table' ? sort : 'asc',
    // The table pages through long ranges ("Load more"); the calendar views load a period at once.
    limit: view === 'table' ? TABLE_PAGE : 1000,
  };
  const query: MeetingQuery = idList ? { ids: idList, sort, limit: 1000 } : filtered;
  // A chip that lets nothing through (every status "is not"): nothing to ask the API for.
  const noStatus = !idList && (statuses?.length === 0 || types?.length === 0);
  const { meetings: rows, loading, more, error, loadMore } = useMeetingList(noStatus ? null : query);
  // The rest of the row (several people, is not, the other fields) filters what came back.
  const shown = noStatus ? [] : idList ? rows : applyFilters(rows, fields, filters, { today, fiscalMonth: s.workspace.fiscalMonth });

  // ------------------------------------------------------------ navigation
  const step = (dir: -1 | 1) => {
    if (view === 'day') update({ date: addDays(date, dir) });
    else if (view === 'week') update({ date: addDays(date, 7 * dir) });
    else if (view === 'month') update({ date: addMonths(date, dir) });
    else {
      const len = daysBetween(tableFrom, tableTo) + 1;
      update({ from: addDays(tableFrom, dir * len), to: addDays(tableTo, dir * len) });
    }
  };
  const goToday = () => {
    if (view !== 'table') return update({ date: today });
    const len = daysBetween(tableFrom, tableTo);
    update({ from: today, to: addDays(today, len) });
  };
  /** Switching views keeps the period: the table takes the visible days; a calendar view the table's first day. */
  const setView = (v: View) => {
    if (v === view) return;
    if (idList) update({ ids: null, report: null });
    if (v === 'table') update({ view: v, from: view === 'month' ? monthRange(date, tz).first : range.first, to: view === 'month' ? monthRange(date, tz).last : range.last });
    else update({ view: v, date: view === 'table' ? tableFrom : date, from: null, to: null });
  };

  const title =
    view === 'day'
      ? dateLabel(date, { year: true, weekday: 'long' })
      : view === 'week'
        ? `${dateLabel(range.first, { weekday: false })} – ${dateLabel(range.last, { weekday: false, year: true })}`
        : view === 'month'
          ? monthLabel(date)
          : `${dateLabel(tableFrom, { weekday: false, year: true })} – ${dateLabel(tableTo, { weekday: false, year: true })}`;

  // ------------------------------------------------------------ filters
  const dealLabel = deal ? (s.leads.find((l) => l.id === deal)?.title || s.leads.find((l) => l.id === deal)?.company || rows.find((m) => m.dealId === deal)?.dealTitle || 'Opportunity') : '';
  const contactLabel = contact ? (allPeople(s).find((p) => p.contactId === contact)?.name ?? 'Contact') : '';
  const typeOne = types?.length === 1 ? types[0] : undefined;

  // ------------------------------------------------------------ meetings
  const open = useCallback((id: string) => navigate(paths.meeting(id)), [navigate]);
  // What a new meeting starts with: the filters (company, deal, contact, a single type, a salesperson).
  const seed = useMemo(
    () => ({
      companyId: company || null,
      dealId: deal || null,
      contactId: contact || null,
      type: typeOne,
      organizerUserId: user && user !== me ? user : null,
    }),
    [company, deal, contact, typeOne, user, me],
  );

  // The meeting being made (CD-212): it belongs to the view and period it was started in.
  const scope = `${view}:${date}`;
  const [drafting, setDrafting] = useState<{ scope: string; draft: CalendarDraft } | null>(null);
  const draft = drafting?.scope === scope && !phone && !idList ? drafting.draft : null;
  const setDraft = useCallback((d: CalendarDraft | null) => setDrafting(d ? { scope, draft: d } : null), [scope]);
  // A press outside the popover only closes it: the click that follows doesn't start another.
  const closedAt = useRef(0);
  const closeDraft = useCallback((outside?: boolean) => {
    if (outside) closedAt.current = Date.now();
    setDrafting(null);
  }, []);

  const justClosed = useCallback(() => Date.now() - closedAt.current < 500, []);
  const create = useCallback(
    (start: string) => {
      if (phone) return openDialog({ ...seed, start });
      if (justClosed()) return;
      // Month: the day at 09:00, for an hour, next to the day.
      const day = instantToZoned(start, tz).date;
      const at = zonedToInstant(day, 9 * 60, tz);
      setDraft({ start: at, end: at + 3_600_000, anchor: `.cal-cell[data-day="${day}"]` });
    },
    [phone, seed, openDialog, tz, setDraft, justClosed],
  );
  const canEdit = actions.canEdit;
  const canDrag = useCallback((m: ApiMeeting) => !phone && m.status === 'planned' && canEdit(m), [phone, canEdit]);
  const reschedule = actions.reschedule;
  const onReschedule = useCallback((m: ApiMeeting, startsAt: string, endsAt: string) => void reschedule(m.id, startsAt, endsAt), [reschedule]);
  const openDay = useCallback((d: string) => update({ view: 'day', date: d }), [update]);

  return (
    <Screen title="Calendar">
      <div className="cal" data-testid="calendar" data-view={view}>
        <div className="cal-toolbar">
          <div className="cal-nav">
            {idList ? (
              <h2 className="cal-title" data-testid="cal-title">
                Meetings from report
              </h2>
            ) : (
              <>
            <button type="button" className="btn-plain" data-testid="cal-today" onClick={goToday}>
              Today
            </button>
            <button type="button" className="btn-plain cal-arrow" aria-label="Previous" data-testid="cal-prev" onClick={() => step(-1)}>
              ‹
            </button>
            <button type="button" className="btn-plain cal-arrow" aria-label="Next" data-testid="cal-next" onClick={() => step(1)}>
              ›
            </button>
            {view === 'table' ? (
              <span className="cal-range">
                <input type="date" className="pay-input" aria-label="From" data-testid="cal-from" value={tableFrom} onChange={(e) => isIsoDate(e.target.value) && update({ from: e.target.value, to: e.target.value > tableTo ? e.target.value : tableTo })} />
                <span>–</span>
                <input type="date" className="pay-input" aria-label="To" data-testid="cal-to" value={tableTo} onChange={(e) => isIsoDate(e.target.value) && update({ to: e.target.value < tableFrom ? tableFrom : e.target.value })} />
              </span>
            ) : (
              <input type="date" className="pay-input" aria-label="Go to date" data-testid="cal-date" value={date} onChange={(e) => isIsoDate(e.target.value) && update({ date: e.target.value })} />
            )}
            <h2 className="cal-title" data-testid="cal-title">
              {title}
            </h2>
              </>
            )}
          </div>
          <div className="cal-views" role="tablist" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" role="tab" aria-selected={v.value === view} data-testid={'view-' + v.value} className={v.value === view ? 'on' : ''} onClick={() => setView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" data-testid="cal-new" onClick={() => openDialog({ companyId: company || null, dealId: deal || null, contactId: contact || null, type: seed.type, organizerUserId: seed.organizerUserId })}>
            + New meeting
          </button>
        </div>

        <div className="cal-filters" data-testid="cal-filters">
          {idList ? (
            <span className="cal-chip-filter" data-testid="chip-ids">
              {idList.length} meeting{idList.length === 1 ? '' : 's'} from report
              <button type="button" aria-label="Show the whole period instead" onClick={() => update({ ids: null, report: null })}>
                <XIcon size={11} />
              </button>
            </span>
          ) : (
            <>
          <FilterRow fields={fields} value={filters} onChange={setFilters} people={filterPeople(s, me)} me={me} onClearAll={() => update({ deal: null, contact: null, notClosed: null, missingMinutes: null, report: null })} />
          {view === 'table' && (
            <>
              <label className="cal-check">
                <input type="checkbox" data-testid="filter-not-closed" checked={notClosed} onChange={(e) => update({ notClosed: e.target.checked ? '1' : null })} />
                Not closed
              </label>
              <label className="cal-check">
                <input type="checkbox" data-testid="filter-missing-minutes" checked={missingMinutes} onChange={(e) => update({ missingMinutes: e.target.checked ? '1' : null })} />
                Held, minutes missing
              </label>
            </>
          )}
          {deal && (
            <span className="cal-chip-filter" data-testid="chip-deal">
              Opportunity: {dealLabel}
              <button type="button" aria-label="Remove the opportunity filter" onClick={() => update({ deal: null })}>
                <XIcon size={11} />
              </button>
            </span>
          )}
          {contact && (
            <span className="cal-chip-filter" data-testid="chip-contact">
              Contact: {contactLabel}
              <button type="button" aria-label="Remove the contact filter" onClick={() => update({ contact: null })}>
                <XIcon size={11} />
              </button>
            </span>
          )}
          {reportCount > 0 && (
            <span className="cal-chip-filter" data-testid="chip-report" title="Too many meetings to list one by one: the closest filters are shown. A shared visit can show for each salesperson at it.">
              {reportCount} meetings from report · showing the matching filters
              <button type="button" aria-label="Remove the report note" onClick={() => update({ report: null })}>
                <XIcon size={11} />
              </button>
            </span>
          )}
            </>
          )}
          <span className="cal-meta" aria-live="polite">
            {loading ? 'Loading…' : error ? 'Could not load the meetings: ' + error : `${shown.length} meeting${shown.length === 1 ? '' : 's'}${more ? ' (more not shown)' : ''}`}
          </span>
        </div>

        {view === 'table' ? (
          <MeetingTable meetings={shown} sort={sort} onSort={() => update({ sort: sort === 'asc' ? 'desc' : 'asc' })} onOpen={open} more={more} onMore={loadMore} />
        ) : view === 'month' ? (
          <MonthGrid days={days} month={date.slice(0, 7)} meetings={shown} tz={tz} onOpen={open} onCreate={create} onDay={openDay} canDrag={canDrag} onReschedule={onReschedule} draftDay={draft ? instantToZoned(draft.start, tz).date : null} />
        ) : view === 'week' && phone ? (
          <DayList days={days} meetings={shown} tz={tz} onOpen={open} onCreate={create} />
        ) : (
          <TimeGrid
            key={view}
            days={days}
            meetings={shown}
            tz={tz}
            onOpen={open}
            onCreate={create}
            draft={draft}
            onDraft={phone ? undefined : setDraft}
            justClosed={justClosed}
            canDrag={canDrag}
            onReschedule={onReschedule}
            onDay={view === 'week' ? openDay : undefined}
          />
        )}
        {draft && <QuickCreate key={drafting!.scope + ':' + draft.anchor} draft={draft} seed={seed} onChange={setDraft} onClose={closeDraft} />}
      </div>
    </Screen>
  );
}
