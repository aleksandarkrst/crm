import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconRow } from '../../components/icons';
import { RichText } from '../../components/RichText';
import type { ApiMeeting, MeetingInput, MeetingType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { hasEmail, locationUrl, MEETING_TYPES } from '../../store/meetings';
import { endSlots, keepLength, lengthLabel, momentOf } from '../../store/meetingTime';
import { companyLabels, companyRecords, memberLabels, memberName } from '../../store/selectors';
import { useStore } from '../../store/store';
import { instantToZoned } from '../../store/time';
import { type GuestRow, GuestsField } from './Guests';
import { DateField, TimeField } from './WhenFields';

/** Typing pauses this long before a text field saves (as on the deal page). */
const TYPING_MS = 600;

/**
 * One inline field of the meeting page (CD-212), as on the deal page: it shows the edit at once
 * and saves it after a typing pause (`delay`; pickers save at once), or when the field loses focus
 * (`flush`). While an edit waits or saves, a new value from the server doesn't overwrite it; when
 * a save is refused (the store said why) the field shows the saved value again.
 */
export function useField(value: string, commit: (v: string) => Promise<boolean>, delay: number) {
  const [draft, setDraft] = useState(value);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ value, draft, commit });
  latest.current = { ...latest.current, value, commit };
  useEffect(() => {
    if (!busy.current) {
      latest.current.draft = value;
      setDraft(value);
    }
  }, [value]);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { draft: v, value: saved, commit: save } = latest.current;
    if (v === saved) {
      busy.current = false;
      return;
    }
    busy.current = true;
    const ok = await save(v);
    // Still typing: the next save is on its way.
    busy.current = timer.current !== undefined;
    if (!ok && !busy.current) {
      latest.current.draft = latest.current.value;
      setDraft(latest.current.value);
    }
  }, []);
  const change = (v: string) => {
    latest.current.draft = v;
    setDraft(v);
    busy.current = true;
    clearTimeout(timer.current);
    timer.current = undefined;
    if (delay === 0) void flush();
    else timer.current = setTimeout(() => void flush(), delay);
  };
  // Leaving the page sends what is still waiting.
  useEffect(
    () => () => {
      if (timer.current !== undefined) void flush();
    },
    [flush],
  );
  return { draft, change, flush };
}

/** Saves some fields of the meeting; false (after the store said why) when it wasn't saved. */
function useSave(m: ApiMeeting) {
  const { meetings } = useStore();
  const id = m.id;
  return useCallback((input: MeetingInput, what: string) => meetings.saveField(id, input, what), [meetings, id]);
}

/** The meeting's title in the page header, edited in place (CD-212). */
export function MeetingTitle({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { flash } = useStore();
  const save = useSave(m);
  const title = useField(
    m.title,
    async (v) => {
      const t = v.trim();
      if (!t) {
        flash('Give the meeting a title.');
        return false;
      }
      if (t.length > 200) {
        flash('The title can be at most 200 characters.');
        return false;
      }
      return t === m.title ? true : save({ title: t }, 'the title');
    },
    TYPING_MS,
  );
  if (!editable)
    return (
      <h2 className={'meeting-title' + (m.status === 'cancelled' ? ' is-cancelled' : '')} data-testid="meeting-page-title">
        {m.title}
      </h2>
    );
  return (
    <input
      className="ghost deal-title meeting-title-input"
      aria-label="Meeting title"
      data-testid="meeting-title-input"
      maxLength={220}
      value={title.draft}
      onChange={(e) => title.change(e.target.value)}
      onBlur={() => void title.flush()}
    />
  );
}

/**
 * The meeting's date and time on one line (CD-221): date, start – end (the end date only when it
 * is another day), in 24-hour time. A new start keeps the length; an end before the start is
 * refused (it says so and shows the saved time again).
 */
export function MeetingWhen({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { s, flash } = useStore();
  const save = useSave(m);
  const tz = s.workspace.timezone;
  // Start and end together ("startIso|endIso").
  const when = useField(
    `${m.startsAt}|${m.endsAt}`,
    async (v) => {
      const [a = '', b = ''] = v.split('|');
      const start = Date.parse(a);
      const end = Date.parse(b);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (end <= start) {
        flash('The end must be after the start.');
        return false;
      }
      const input: MeetingInput = {};
      if (start !== Date.parse(m.startsAt)) input.startsAt = new Date(start).toISOString();
      if (end !== Date.parse(m.endsAt)) input.endsAt = new Date(end).toISOString();
      return Object.keys(input).length ? save(input, 'the time') : true;
    },
    TYPING_MS,
  );
  const [startIso = m.startsAt, endIso = m.endsAt] = when.draft.split('|');
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const a = instantToZoned(start, tz);
  const b = instantToZoned(end, tz);
  const set = (nextStart: number, nextEnd: number) => {
    if (Number.isFinite(nextStart) && Number.isFinite(nextEnd)) when.change(`${new Date(nextStart).toISOString()}|${new Date(nextEnd).toISOString()}`);
  };
  const setStart = (at: number) => set(at, keepLength(start, end, at));
  const slots = useMemo(() => endSlots(start, tz), [start, tz]);
  const options = slots.map((x) => ({ time: x.time, hint: lengthLabel((x.at - start) / 60_000) + (x.nextDay ? ' · next day' : '') }));
  return (
    <div className="mf-when" data-testid="meeting-field-when">
      <DateField label="Date" testId="meeting-field-date" value={a.date} disabled={!editable} onChange={(date) => setStart(momentOf(date, a.time, tz))} />
      <TimeField label="Starts" testId="meeting-field-start" value={a.time} disabled={!editable} onChange={(t) => setStart(momentOf(a.date, t, tz))} />
      <span className="mf-to">to</span>
      <TimeField label="Ends" testId="meeting-field-end" value={b.time} options={options} disabled={!editable} invalid={end <= start} onChange={(t, i) => set(start, i !== undefined ? slots[i]!.at : momentOf(b.date, t, tz))} />
      {b.date !== a.date && <DateField label="End date" testId="meeting-field-end-date" value={b.date} disabled={!editable} onChange={(date) => set(start, momentOf(date, b.time, tz))} />}
    </div>
  );
}

/**
 * The meeting's details, each edited in place (CD-212, laid out as the New meeting page in
 * CD-221): type, company and deal, location, organizer (owners and admins pick another one,
 * spec 5.3) and the agenda. Read-only for people who can't change the meeting, and while it is
 * cancelled.
 */
export function MeetingDetails({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { s, set, session, flash } = useStore();
  const save = useSave(m);
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';

  // Type: saved at once.
  const type = useField(m.type, (v) => save({ type: v as MeetingType }, 'the type'), 0);

  // Location: typed, saved after a pause.
  const location = useField(
    m.location ?? '',
    (v) => {
      if (v.length > 300) {
        flash('The location can be at most 300 characters.');
        return Promise.resolve(false);
      }
      return save({ location: v.trim() || null }, 'the location');
    },
    TYPING_MS,
  );
  const url = locationUrl(location.draft);

  // Company and deal: another company needs one of its deals (CD-213) before it is saved.
  const records = useMemo(() => companyRecords(s), [s]);
  const companies = useMemo(() => {
    const labels = companyLabels(records);
    return records.map((c) => ({ value: c.id, label: labels.get(c.id) ?? c.name })).sort((x, y) => x.label.localeCompare(y.label));
  }, [records]);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const companyId = movingTo ?? m.companyId;
  const deals = s.leads.filter((l) => l.companyId === companyId).sort((x, y) => Number(y.outcome === 'open') - Number(x.outcome === 'open'));
  const [savingDeal, setSavingDeal] = useState(false);
  const saveDeal = async (dealId: string, company = companyId) => {
    setSavingDeal(true);
    const input: MeetingInput = { dealId };
    if (company !== m.companyId) input.companyId = company;
    const ok = await save(input, company !== m.companyId ? 'the company' : 'the deal');
    setSavingDeal(false);
    if (ok) setMovingTo(null);
  };
  const pickCompany = (id: string) => {
    if (id === m.companyId) return setMovingTo(null);
    const open = s.leads.filter((l) => l.companyId === id && l.outcome === 'open');
    if (open.length === 1) return void saveDeal(open[0]!.id, id);
    setMovingTo(id);
  };
  // "+ New deal" for a company without one: the deal made there is picked and saved.
  const made = s.newLeadMade;
  useEffect(() => {
    if (!made || !movingTo || made.companyId !== movingTo) return;
    set({ newLeadMade: null });
    void saveDeal(made.dealId, movingTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per deal made
  }, [made, movingTo]);
  const deal = m.dealId ? s.leads.find((l) => l.id === m.dealId) : undefined;
  const companyName = records.find((c) => c.id === companyId)?.name ?? m.companyName;

  // Organizer: owners and admins pick another one (spec 5.3); they join as an internal participant.
  const members = useMemo(() => [...memberLabels(s)].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name)), [s]);
  const internalIds = m.participants.filter((p) => p.kind === 'internal' && p.userId && !p.deleted && p.userId !== m.organizerUserId).map((p) => p.userId!);
  const organizer = useField(
    m.organizerUserId ?? '',
    (v) => (v ? save({ organizerUserId: v, internalUserIds: internalIds.filter((id) => id !== v) }, 'the organizer') : Promise.resolve(false)),
    0,
  );

  // Agenda: typed, saved after a pause.
  const agenda = useField(
    m.agenda ?? '',
    (v) => {
      if (v.length > 5000) {
        flash('The agenda can be at most 5,000 characters.');
        return Promise.resolve(false);
      }
      return save({ agenda: v.trim() || null }, 'the agenda');
    },
    TYPING_MS,
  );

  return (
    <section className="mf-details" data-testid="meeting-details" aria-label="Meeting details">
      <div className="mf-col-title">Meeting details</div>
      <IconRow icon="note" label="Type">
        <select className="ghost" aria-label="Type" data-testid="meeting-field-type" value={type.draft} disabled={!editable} onChange={(e) => type.change(e.target.value)}>
          {MEETING_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </IconRow>
      <IconRow icon="company" label="Company">
        <select className="ghost" aria-label="Company" data-testid="meeting-field-company" value={companyId} disabled={!editable || savingDeal} onChange={(e) => pickCompany(e.target.value)}>
          {!companies.some((c) => c.value === companyId) && <option value={companyId}>{companyName}</option>}
          {companies.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Link to={paths.company(m.companyId)} className="meeting-field-link">
          Open
        </Link>
      </IconRow>
      <IconRow icon="value" label="Deal">
        {movingTo && deals.length === 0 ? (
          <span className="meeting-no-deals" data-testid="meeting-field-no-deals" style={{ flex: 1 }}>
            <span className="meeting-muted">{companyName} has no deals yet</span>
            <button type="button" className="btn-plain" onClick={() => set({ newLeadOpen: true, newLeadCompanyId: movingTo, newLeadContactId: null, newLeadForMeeting: true, newLeadMade: null })}>
              + New deal
            </button>
          </span>
        ) : (
          <select className="ghost" aria-label="Deal" data-testid="meeting-field-deal" value={movingTo ? '' : (m.dealId ?? '')} disabled={!editable || savingDeal} onChange={(e) => e.target.value && void saveDeal(e.target.value)}>
            {(movingTo || !m.dealId) && (
              <option value="" disabled>
                {movingTo ? `Pick a deal of ${companyName} to move the meeting` : 'No deal'}
              </option>
            )}
            {!movingTo && m.dealId && !deals.some((l) => l.id === m.dealId) && <option value={m.dealId}>{m.dealTitle ?? 'Deal'}</option>}
            {deals.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.title || l.company) + (l.outcome === 'open' ? '' : l.outcome === 'won' ? ' · won' : ' · lost')}
              </option>
            ))}
          </select>
        )}
        {m.dealId && !movingTo && (
          <Link to={paths.lead(m.dealId)} className="meeting-field-link" title={deal?.title || deal?.company || m.dealTitle || 'Deal'}>
            Open
          </Link>
        )}
        {movingTo && (
          <button type="button" className="btn-plain meeting-field-link" onClick={() => setMovingTo(null)}>
            Keep {m.companyName}
          </button>
        )}
      </IconRow>
      <IconRow icon="location" label="Location">
        <input
          className="ghost"
          aria-label="Location"
          data-testid="meeting-field-location"
          maxLength={320}
          placeholder={editable ? (type.draft === 'online' ? 'Add a meeting link' : 'Add location') : 'No location'}
          value={location.draft}
          disabled={!editable}
          onChange={(e) => location.change(e.target.value)}
          onBlur={() => void location.flush()}
        />
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="meeting-field-link" data-testid="meeting-field-location-link">
            Open
          </a>
        )}
      </IconRow>
      <IconRow icon="owner" label="Organizer">
        {editable && admin ? (
          <select className="ghost" aria-label="Organizer" data-testid="meeting-field-organizer" value={organizer.draft} onChange={(e) => organizer.change(e.target.value)}>
            {!organizer.draft && (
              <option value="" disabled>
                Organizer left · pick a new one
              </option>
            )}
            {m.organizerUserId && !members.some((x) => x.id === m.organizerUserId) && <option value={m.organizerUserId}>{memberName(s, m.organizerUserId, m.organizerName)}</option>}
            {members.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : m.organizerUserId ? (
          <span className="field-value" data-testid="meeting-field-organizer-name" title={editable ? 'Only owners and admins can change the organizer' : undefined}>
            {memberName(s, m.organizerUserId, m.organizerName)}
          </span>
        ) : null}
        {!m.organizerUserId && (
          <span className="badge badge-warn" data-testid="meeting-organizer-left" style={{ whiteSpace: 'nowrap' }}>
            Organizer left
          </span>
        )}
      </IconRow>
      <IconRow icon="agenda" label="Agenda">
        {editable ? (
          <textarea
            className="ghost meeting-agenda-input"
            aria-label="Agenda"
            data-testid="meeting-field-agenda"
            maxLength={5200}
            placeholder="Add agenda"
            value={agenda.draft}
            onChange={(e) => agenda.change(e.target.value)}
            onBlur={() => void agenda.flush()}
          />
        ) : m.agenda ? (
          <div className="field-value" data-testid="meeting-agenda-view">
            <RichText text={m.agenda} />
          </div>
        ) : (
          <span className="field-value meeting-muted">No agenda</span>
        )}
      </IconRow>
    </section>
  );
}

/**
 * The guests (CD-221): the organizer, the colleagues and the customer's people, with "Add
 * guests" (members and the meeting company's contacts, or a new contact there). Each change is
 * saved at once. People who left stay on past meetings (CD-131), marked.
 */
export function MeetingGuests({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const save = useSave(m);
  const [busy, setBusy] = useState(false);
  const internalIds = m.participants.filter((p) => p.kind === 'internal' && p.userId && !p.deleted && p.userId !== m.organizerUserId).map((p) => p.userId!);
  const externalIds = m.participants.filter((p) => p.kind === 'external' && p.contactId && !p.deleted).map((p) => p.contactId!);
  const run = async (input: MeetingInput, what: string) => {
    setBusy(true);
    await save(input, what);
    setBusy(false);
  };
  const rows: GuestRow[] = m.participants.map((p) => {
    const organizer = p.kind === 'internal' && !!p.userId && p.userId === m.organizerUserId;
    const name = p.deleted ? `${p.name} (${p.kind === 'internal' ? 'former member' : 'deleted'})` : p.name;
    const sub = organizer ? 'Organizer' : p.kind === 'internal' ? 'Colleague' : hasEmail(p.email) ? p.email! : 'No email';
    const removable = !organizer && !p.deleted && (p.kind === 'internal' ? !!p.userId : !!p.contactId);
    return {
      key: p.id,
      kind: p.kind,
      name,
      sub,
      muted: p.deleted,
      to: p.kind === 'external' && p.contactId && !p.deleted ? paths.contact(p.contactId) : undefined,
      onRemove: removable
        ? () =>
            void (p.kind === 'internal'
              ? run({ internalUserIds: internalIds.filter((id) => id !== p.userId) }, `removing ${p.name}`)
              : run({ externalContactIds: externalIds.filter((id) => id !== p.contactId) }, `removing ${p.name}`))
        : undefined,
    };
  });
  return (
    <section className="mf-guests" aria-label="Guests">
      <div className="mf-col-title">
        Guests <span className="meeting-muted">{m.participants.length}</span>
      </div>
      <GuestsField
        testId="meeting-field-guests"
        rows={rows}
        companyId={m.companyId}
        companyName={m.companyName}
        users={[...(m.organizerUserId ? [m.organizerUserId] : []), ...internalIds]}
        contacts={externalIds}
        editable={editable}
        busy={busy}
        onAddUser={(id) => void run({ internalUserIds: [...internalIds, id] }, 'the new participant')}
        onAddContact={(id) => void run({ externalContactIds: [...externalIds, id] }, 'the new contact')}
      />
    </section>
  );
}
