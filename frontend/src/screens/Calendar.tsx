import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { XIcon } from '../components/ui';
import type { ApiMeeting, MeetingQuery, MeetingStatus, MeetingType } from '../lib/api';
import { paths } from '../lib/paths';
import { DEFAULT_STATUSES, isMeetingStatus, isMeetingType, MEETING_STATUSES, MEETING_TYPES, STATUS_LABEL } from '../store/meetings';
import { allPeople, companyLabels, companyRecords, memberLabels } from '../store/selectors';
import { useStore } from '../store/store';
import { addDays, addMonths, dateLabel, datesBetween, datesRange, dayRange, daysBetween, isIsoDate, monthGridRange, monthLabel, monthRange, todayIn, weekRange } from '../store/time';
import { useMeetingList } from '../store/useMeetings';
import { DayList } from './calendar/DayList';
import { MeetingTable } from './calendar/MeetingTable';
import { MonthGrid } from './calendar/MonthGrid';
import { TimeGrid } from './calendar/TimeGrid';

type View = 'day' | 'week' | 'month' | 'table';
const VIEWS: { value: View; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'table', label: 'Table' },
];
/** The New meeting dialog's prefill in the URL (`?new=1&companyId=…`), read once and removed. */
const NEW_PARAMS = ['new', 'companyId', 'dealId', 'contactId', 'type', 'organizer', 'start'];

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
 * The Calendar (CD-130): every meeting in Day, Week, Month and Table views. The view, the period
 * and the filters live in the URL, so a link shows the same meetings; switching views keeps the
 * filters and the period. Times are in the workspace time zone.
 */
export function Calendar() {
  const store = useStore();
  const { s, session, meetings: actions } = store;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const tz = s.workspace.timezone;
  const today = todayIn(tz);
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';

  // ------------------------------------------------------------ state from the URL
  const raw = params.get('view');
  const view: View = raw === 'day' || raw === 'week' || raw === 'month' || raw === 'table' ? raw : phone ? 'day' : 'week';
  const date = isIsoDate(params.get('date')) ? params.get('date')! : today;
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const tableFrom = isIsoDate(fromParam) ? fromParam : monthRange(date, tz).first;
  const tableTo = isIsoDate(toParam) && toParam >= tableFrom ? toParam : isIsoDate(fromParam) ? addDays(tableFrom, 30) : monthRange(date, tz).last;
  // Salesperson: members see their own meetings by default, owners and admins everyone's.
  const user = params.get('user') || (admin ? 'all' : 'me');
  const types = (params.get('type') ?? '').split(',').filter(isMeetingType);
  const statuses: MeetingStatus[] = params.has('status') ? (params.get('status') ?? '').split(',').filter(isMeetingStatus) : DEFAULT_STATUSES;
  const company = params.get('company') ?? '';
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

  // ?new=1&companyId=…: open the prefilled New meeting dialog (from links, visit plans), once.
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

  // ------------------------------------------------------------ the period on screen
  const range = useMemo(() => {
    if (view === 'day') return dayRange(date, tz);
    if (view === 'week') return weekRange(date, tz);
    if (view === 'month') return monthGridRange(date, tz);
    return datesRange(tableFrom, tableTo, tz);
  }, [view, date, tableFrom, tableTo, tz]);
  const days = useMemo(() => datesBetween(range.first, range.last), [range]);

  const query: MeetingQuery = {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    userId: user === 'all' ? undefined : user === 'me' ? session.userId : user,
    companyId: company || undefined,
    dealId: deal || undefined,
    contactId: contact || undefined,
    type: types.length ? types : undefined,
    status: statuses.length ? statuses : undefined,
    notClosed: view === 'table' && notClosed ? true : undefined,
    missingMinutes: view === 'table' && missingMinutes ? true : undefined,
    sort: view === 'table' ? sort : 'asc',
    limit: 1000,
  };
  const noStatus = statuses.length === 0;
  const { meetings: rows, loading, more, error } = useMeetingList(noStatus ? null : query);
  const shown = noStatus ? [] : rows;

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
    if (v === 'table') update({ view: v, from: view === 'month' ? monthRange(date, tz).first : range.first, to: view === 'month' ? monthRange(date, tz).last : range.last });
    else update({ view: v, date: view === 'table' ? tableFrom : date, from: null, to: null });
  };
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const title =
    view === 'day'
      ? dateLabel(date, { year: true, weekday: 'long' })
      : view === 'week'
        ? `${dateLabel(range.first, { weekday: false })} – ${dateLabel(range.last, { weekday: false, year: true })}`
        : view === 'month'
          ? monthLabel(date)
          : `${dateLabel(tableFrom, { weekday: false, year: true })} – ${dateLabel(tableTo, { weekday: false, year: true })}`;

  // ------------------------------------------------------------ filters
  const members = useMemo(() => [...memberLabels(s)], [s]);
  const records = useMemo(() => companyRecords(s), [s]);
  const companies = useMemo(() => {
    const labels = companyLabels(records);
    return records.map((c) => ({ value: c.id, label: labels.get(c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [records]);
  const dealLabel = deal ? (s.leads.find((l) => l.id === deal)?.title || s.leads.find((l) => l.id === deal)?.company || rows.find((m) => m.dealId === deal)?.dealTitle || 'Deal') : '';
  const contactLabel = contact ? (allPeople(s).find((p) => p.contactId === contact)?.name ?? 'Contact') : '';
  const dirty = user !== (admin ? 'all' : 'me') || types.length > 0 || params.has('status') || !!company || !!deal || !!contact || notClosed || missingMinutes;

  // ------------------------------------------------------------ meetings
  const open = useCallback((id: string) => navigate(paths.meeting(id)), [navigate]);
  const create = useCallback(
    (start: string) =>
      openDialog({
        start,
        companyId: company || null,
        dealId: deal || null,
        contactId: contact || null,
        type: types.length === 1 ? types[0] : undefined,
        organizerUserId: user !== 'all' && user !== 'me' ? user : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filters decide
    [company, deal, contact, types.join(','), user],
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
          </div>
          <div className="cal-views" role="tablist" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" role="tab" aria-selected={v.value === view} data-testid={'view-' + v.value} className={v.value === view ? 'on' : ''} onClick={() => setView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" data-testid="cal-new" onClick={() => openDialog({ companyId: company || null, dealId: deal || null, contactId: contact || null })}>
            + New meeting
          </button>
        </div>

        <div className="cal-filters" data-testid="cal-filters">
          <select className="cal-select" aria-label="Salesperson" data-testid="filter-user" value={user} onChange={(e) => update({ user: e.target.value })}>
            <option value="me">Me</option>
            <option value="all">Everyone</option>
            {members
              .filter(([id]) => id !== session.userId)
              .map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
          </select>
          <select className="cal-select" aria-label="Company" data-testid="filter-company" value={company} onChange={(e) => update({ company: e.target.value || null })}>
            <option value="">All companies</option>
            {company && !companies.some((c) => c.value === company) && <option value={company}>{rows.find((m) => m.companyId === company)?.companyName ?? 'Company'}</option>}
            {companies.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="cal-pills" role="group" aria-label="Type">
            {MEETING_TYPES.map((t) => (
              <button key={t.value} type="button" aria-pressed={types.includes(t.value)} data-testid={'filter-type-' + t.value} className={'cal-pill' + (types.includes(t.value) ? ' on' : '')} onClick={() => update({ type: toggle<MeetingType>(types, t.value).join(',') || null })}>
                <span className={`mt-dot mt-${t.value}`} aria-hidden />
                {t.short}
              </button>
            ))}
          </span>
          <span className="cal-pills" role="group" aria-label="Status">
            {MEETING_STATUSES.map((st) => (
              <button key={st} type="button" aria-pressed={statuses.includes(st)} data-testid={'filter-status-' + st} className={'cal-pill' + (statuses.includes(st) ? ' on' : '')} onClick={() => update({ status: toggle(statuses, st).join(',') })}>
                {STATUS_LABEL[st]}
              </button>
            ))}
          </span>
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
              Deal: {dealLabel}
              <button type="button" aria-label="Remove the deal filter" onClick={() => update({ deal: null })}>
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
          {dirty && (
            <button type="button" className="btn-plain" data-testid="filter-clear" onClick={() => update({ user: null, type: null, status: null, company: null, deal: null, contact: null, notClosed: null, missingMinutes: null })}>
              Clear filters
            </button>
          )}
          <span className="cal-meta" aria-live="polite">
            {loading ? 'Loading…' : error ? 'Could not load the meetings: ' + error : `${shown.length} meeting${shown.length === 1 ? '' : 's'}${more ? ' (more not shown)' : ''}`}
          </span>
        </div>

        {view === 'table' ? (
          <MeetingTable meetings={shown} sort={sort} onSort={() => update({ sort: sort === 'asc' ? 'desc' : 'asc' })} onOpen={open} more={more} />
        ) : view === 'month' ? (
          <MonthGrid days={days} month={date.slice(0, 7)} meetings={shown} tz={tz} onOpen={open} onCreate={create} onDay={openDay} canDrag={canDrag} onReschedule={onReschedule} />
        ) : view === 'week' && phone ? (
          <DayList days={days} meetings={shown} tz={tz} onOpen={open} onCreate={create} />
        ) : (
          <TimeGrid key={view} days={days} meetings={shown} tz={tz} onOpen={open} onCreate={create} canDrag={canDrag} onReschedule={onReschedule} onDay={view === 'week' ? openDay : undefined} />
        )}
      </div>
    </Screen>
  );
}
