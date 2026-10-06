import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '../../components/icons';
import { XIcon } from '../../components/ui';
import type { ApiMeeting, MeetingType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { hasEmail, MEETING_TYPES, type MeetingDialogSeed } from '../../store/meetings';
import { defaultStart, endSlots, keepLength, lengthLabel, momentOf } from '../../store/meetingTime';
import { allPeople, companyIdOfPerson, companyLabels, companyRecords, memberLabels } from '../../store/selectors';
import { useStore } from '../../store/store';
import { instantToZoned, timeLabel, zonedToInstant } from '../../store/time';
import { type GuestRow, GuestsField, useCompanyContacts } from './Guests';
import { DateField, TimeField } from './WhenFields';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const hqOf = (hq: string | undefined) => (hq && hq !== '—' ? hq : '');

interface Draft {
  title: string;
  /** The title follows the company ("Meeting with …") until it is typed in. */
  titleTouched: boolean;
  type: MeetingType;
  start: number;
  end: number;
  location: string;
  /** The location follows the company's HQ for a visit until it is typed in. */
  locationTouched: boolean;
  companyId: string;
  dealId: string;
  organizer: string;
  internal: string[];
  external: string[];
  agenda: string;
}

/** What the Calendar's placeholder shows while the quick create is open. */
export interface QuickDraft {
  start: number;
  end: number;
  title: string;
  type: MeetingType;
}

/**
 * The New meeting form (spec 4.2, laid out like Google Calendar's event, CD-221). Three shapes:
 * - `quick`: the Calendar's quick-create popover: title, type, date and time, guests, location,
 *   agenda, organizer, company and deal (required), "More options" and Save. The time belongs to
 *   the placeholder on the Calendar (`time`, `onDraft`).
 * - `page`: the New meeting page ("More options", /meetings/new): the title with close and Save,
 *   the date and time on one line, the type, then the details beside the guests.
 * - `inline`: the deal's Meeting tab, the page's layout inside the Composer.
 * Rules: a deal of the company is required (CD-213); picking a deal invites its primary contact;
 * the end comes after the start (an error, nothing is lost); moving the start keeps the length;
 * a Customer visit without anyone from the customer warns once; other meetings of the people at
 * that time are shown. `onDone` gets the saved meeting.
 */
export function MeetingForm({
  seed,
  variant,
  onDone,
  onClose,
  submitLabel,
  time,
  onDraft,
  onMore,
}: {
  seed: MeetingDialogSeed;
  variant: 'quick' | 'page' | 'inline';
  onDone: (m: ApiMeeting) => void;
  onClose?: () => void;
  submitLabel?: string;
  time?: { start: number; end: number };
  onDraft?: (d: QuickDraft) => void;
  onMore?: (seed: MeetingDialogSeed) => void;
}) {
  const { s, set, session, meetings, flash } = useStore();
  const tz = s.workspace.timezone;
  const records = useMemo(() => companyRecords(s), [s]);
  const companies = useMemo(() => {
    const labels = companyLabels(records);
    return records.map((c) => ({ value: c.id, label: labels.get(c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [records]);
  const members = useMemo(() => [...memberLabels(s)].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [s]);
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? 'Former member';

  const onlyOpenDeal = (companyId: string) => {
    const open = s.leads.filter((l) => l.companyId === companyId && l.outcome === 'open');
    return open.length === 1 ? open[0]!.id : '';
  };
  const people = useMemo(() => allPeople(s).filter((p) => !!p.contactId), [s]);
  // A contact's company, and a deal's primary contact when they are a contact of the company (CD-221).
  function companyOfContactId(contactId: string): string | null {
    const p = people.find((x) => x.contactId === contactId);
    return p ? companyIdOfPerson(s, p) : null;
  }
  function primaryContactOf(dealId: string, companyId: string): string | null {
    const id = s.leads.find((l) => l.id === dealId)?.contactId;
    return id && companyOfContactId(id) === companyId ? id : null;
  }

  const [d, setD] = useState<Draft>(() => {
    const deal = seed.dealId ? s.leads.find((l) => l.id === seed.dealId) : undefined;
    const contactCompany = seed.contactId ? companyOfContactId(seed.contactId) : null;
    const companyId = seed.companyId || deal?.companyId || contactCompany || '';
    const dealId = deal && deal.companyId === companyId ? deal.id : onlyOpenDeal(companyId);
    const external = new Set<string>(seed.externalContactIds ?? []);
    if (!seed.externalContactIds) {
      if (seed.contactId && contactCompany === companyId) external.add(seed.contactId);
      const primary = dealId ? primaryContactOf(dealId, companyId) : null;
      if (primary) external.add(primary);
    }
    let start = seed.start ? Date.parse(seed.start) : NaN;
    if (!Number.isFinite(start)) {
      const at = defaultStart(Date.now(), tz);
      start = zonedToInstant(at.date, at.time, tz);
    }
    const seededEnd = seed.end ? Date.parse(seed.end) : NaN;
    const type = seed.type ?? 'visit';
    const co = records.find((c) => c.id === companyId);
    const organizer = seed.organizerUserId || session.userId;
    return {
      title: seed.title?.trim() || (co ? `Meeting with ${co.name}` : ''),
      titleTouched: !!seed.title?.trim(),
      type,
      start,
      end: Number.isFinite(seededEnd) && seededEnd > start ? seededEnd : start + HOUR,
      location: seed.location ?? (type === 'visit' ? hqOf(co?.hq) : ''),
      locationTouched: seed.location != null,
      companyId,
      dealId,
      organizer,
      internal: (seed.internalUserIds ?? []).filter((id) => id !== organizer),
      external: [...external],
      agenda: seed.agenda ?? '',
    };
  });

  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [noExternalOk, setNoExternalOk] = useState(false);
  const [overlaps, setOverlaps] = useState<string[]>([]);

  const start = time?.start ?? d.start;
  const end = time?.end ?? d.end;
  const a = instantToZoned(start, tz);
  const b = instantToZoned(end, tz);
  const company = records.find((c) => c.id === d.companyId);
  const companyName = company?.name ?? 'the company';
  // The company's deals, open ones first; won and lost ones can be picked too (CD-213).
  const deals = s.leads.filter((l) => l.companyId === d.companyId).sort((x, y) => Number(y.outcome === 'open') - Number(x.outcome === 'open'));
  const contacts = useCompanyContacts(d.companyId);

  const show = (p: Partial<QuickDraft>) => onDraft?.({ start, end, title: d.title, type: d.type, ...p });
  const patch = (p: Partial<Draft>) => {
    setD((x) => ({ ...x, ...p }));
    setFailure('');
  };
  const setTimes = (nextStart: number, nextEnd: number) => {
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) return;
    setFailure('');
    if (time) show({ start: nextStart, end: nextEnd });
    else setD((x) => ({ ...x, start: nextStart, end: nextEnd }));
  };
  // A new start keeps the length (B7); a length that isn't valid becomes an hour.
  const setStart = (at: number) => setTimes(at, keepLength(start, end, at));
  const slots = useMemo(() => endSlots(start, tz), [start, tz]);
  const endOptions = slots.map((x) => ({ time: x.time, hint: lengthLabel((x.at - start) / MINUTE) + (x.nextDay ? ' · next day' : '') }));

  const setTitle = (title: string) => {
    patch({ title, titleTouched: true });
    show({ title });
  };
  const setType = (type: MeetingType) => {
    setD((x) => ({ ...x, type, location: x.locationTouched ? x.location : type === 'visit' ? hqOf(company?.hq) : '' }));
    show({ type });
  };
  const setCompany = (companyId: string) => {
    const co = records.find((c) => c.id === companyId);
    const dealId = onlyOpenDeal(companyId);
    const primary = dealId ? primaryContactOf(dealId, companyId) : null;
    // External participants are the company's people (CD-212): another company's go.
    const external = d.external.filter((id) => companyOfContactId(id) === companyId);
    const title = d.titleTouched ? d.title : co ? `Meeting with ${co.name}` : '';
    patch({
      companyId,
      dealId,
      external: primary && !external.includes(primary) ? [...external, primary] : external,
      title,
      location: d.locationTouched || d.type !== 'visit' ? d.location : hqOf(co?.hq),
    });
    if (title !== d.title) show({ title });
  };
  // Picking a deal invites its primary contact (CD-221).
  const setDeal = (dealId: string) => {
    const primary = primaryContactOf(dealId, d.companyId);
    patch({ dealId, external: primary && !d.external.includes(primary) ? [...d.external, primary] : d.external });
  };

  // "+ New deal" (CD-213): the New deal dialog for this company; the deal made there is picked here.
  const made = s.newLeadMade;
  useEffect(() => {
    if (!made) return;
    if (made.companyId === d.companyId) setDeal(made.dealId);
    set({ newLeadMade: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per deal made
  }, [made, d.companyId, set]);
  const newDeal = () => set({ newLeadOpen: true, newLeadCompanyId: d.companyId, newLeadContactId: d.external[0] ?? null, newLeadForMeeting: true, newLeadMade: null });

  // "Ana has another meeting at 10:00": the chosen colleagues' other meetings at that time (never blocks saving).
  const people4 = [d.organizer, ...d.internal].filter(Boolean).join(',');
  const startIso = new Date(start).toISOString();
  const endIso = end > start ? new Date(end).toISOString() : '';
  const findOverlaps = meetings.findOverlaps;
  useEffect(() => {
    if (!people4 || !endIso) return setOverlaps([]);
    let alive = true;
    const t = setTimeout(() => {
      findOverlaps(people4.split(','), startIso, endIso).then(
        (rows) => {
          if (!alive) return;
          setOverlaps(
            rows.map(({ userId, meeting }) => {
              const who = userId === session.userId ? 'You have' : `${members.find((m) => m.id === userId)?.name ?? 'A colleague'} has`;
              return `${who} another meeting at ${timeLabel(meeting.startsAt, tz)} (${meeting.title})`;
            }),
          );
        },
        () => alive && setOverlaps([]),
      );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `findOverlaps` is rebuilt with the store; the inputs decide
  }, [people4, startIso, endIso, tz]);

  // ------------------------------------------------------------ validation (AC 6)
  const errors: Partial<Record<'title' | 'time' | 'company' | 'organizer' | 'deal' | 'location' | 'agenda', string>> = {};
  if (!d.title.trim()) errors.title = 'Give the meeting a title.';
  else if (d.title.trim().length > 200) errors.title = 'The title can be at most 200 characters.';
  if (end <= start) errors.time = 'The end must be after the start.';
  if (!d.companyId) errors.company = 'Pick the customer company.';
  if (!d.organizer) errors.organizer = 'Pick an organizer.';
  if (d.companyId && !d.dealId) errors.deal = deals.length ? 'Pick the deal this meeting is for.' : 'This company has no deals yet. Add one with + New deal.';
  if (d.location.length > 300) errors.location = 'The location can be at most 300 characters.';
  if (d.agenda.length > 5000) errors.agenda = 'The agenda can be at most 5,000 characters.';
  const invalid = Object.keys(errors).length > 0;
  const needsExternalWarning = d.type === 'visit' && d.external.length === 0 && !noExternalOk;
  const warnNoExternal = noExternalOk && d.type === 'visit' && d.external.length === 0;

  const save = async () => {
    setTried(true);
    if (invalid || busy) return;
    if (needsExternalWarning) {
      setNoExternalOk(true); // the warning shows; the next click saves
      return;
    }
    setBusy(true);
    setFailure('');
    try {
      const saved = await meetings.create({
        title: d.title.trim(),
        type: d.type,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        location: d.location.trim() || null,
        agenda: d.agenda.trim() || null,
        companyId: d.companyId,
        dealId: d.dealId,
        organizerUserId: d.organizer,
        internalUserIds: d.internal.filter((id) => id !== d.organizer),
        externalContactIds: d.external,
      });
      flash(`${saved.title} scheduled`);
      onDone(saved);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const more = () =>
    onMore?.({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      title: d.titleTouched ? d.title : null,
      type: d.type,
      companyId: d.companyId || null,
      dealId: d.dealId || null,
      organizerUserId: d.organizer || null,
      location: d.locationTouched ? d.location : null,
      agenda: d.agenda || null,
      internalUserIds: d.internal,
      externalContactIds: d.external,
    });

  // ------------------------------------------------------------ parts
  const shown = (k: keyof typeof errors) => (tried && errors[k] ? <span className="meeting-error">{errors[k]}</span> : null);
  const guests: GuestRow[] = [
    { key: 'o:' + d.organizer, kind: 'internal', name: d.organizer ? memberName(d.organizer) : 'Organizer left', sub: 'Organizer' },
    ...d.internal.map((id): GuestRow => ({ key: 'u:' + id, kind: 'internal', name: memberName(id), sub: 'Colleague', onRemove: () => patch({ internal: d.internal.filter((x) => x !== id) }) })),
    ...d.external.map((id): GuestRow => {
      const p = contacts.find((c) => c.contactId === id);
      return { key: 'c:' + id, kind: 'external', name: p?.name ?? 'Contact', sub: hasEmail(p?.email) ? p!.email : 'No email', to: paths.contact(id), onRemove: () => patch({ external: d.external.filter((x) => x !== id) }) };
    }),
  ];
  const guestsField = (
    <GuestsField
      rows={guests}
      companyId={d.companyId}
      companyName={companyName}
      users={[d.organizer, ...d.internal]}
      contacts={d.external}
      onAddUser={(id) => patch({ internal: [...d.internal, id] })}
      onAddContact={(id) => setD((x) => ({ ...x, external: x.external.includes(id) ? x.external : [...x.external, id] }))}
    />
  );

  const titleInput = (
    <input
      className={variant === 'quick' ? 'cal-quick-title' : 'mf-title'}
      data-testid={variant === 'quick' ? 'quick-title' : 'meeting-title'}
      aria-label="Title"
      autoFocus={variant !== 'inline'}
      maxLength={220}
      placeholder="Add title"
      value={d.title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => variant === 'quick' && e.key === 'Enter' && void save()}
    />
  );
  const when = (
    <div className="mf-when" data-testid="meeting-when-fields">
      <DateField label="Date" testId="meeting-date" value={a.date} onChange={(date) => setStart(momentOf(date, a.time, tz))} />
      <TimeField label="Starts" testId="meeting-start" value={a.time} onChange={(t) => setStart(momentOf(a.date, t, tz))} />
      <span className="mf-to">to</span>
      <TimeField label="Ends" testId="meeting-end" value={b.time} options={endOptions} invalid={!!errors.time} onChange={(t, i) => setTimes(start, i !== undefined ? slots[i]!.at : momentOf(b.date, t, tz))} />
      {variant === 'quick' ? (
        b.date !== a.date && end > start && <span className="meeting-muted">next day</span>
      ) : (
        <DateField label="End date" testId="meeting-end-date" value={b.date} onChange={(date) => setTimes(start, momentOf(date, b.time, tz))} />
      )}
    </div>
  );
  const timeError = errors.time ? (
    <span className="meeting-error" data-testid="meeting-time-error">
      {errors.time}
    </span>
  ) : null;
  const types = (
    <div className="mf-types" role="group" aria-label="Type" data-testid="meeting-type" data-value={d.type}>
      {MEETING_TYPES.map((t) => (
        <button key={t.value} type="button" className={'cal-pill' + (d.type === t.value ? ' on' : '')} aria-pressed={d.type === t.value} data-testid={'meeting-type-' + t.value} title={t.label} onClick={() => setType(t.value)}>
          <span className={`mt-dot mt-${t.value}`} aria-hidden />
          {variant === 'quick' ? t.short : t.label}
        </button>
      ))}
    </div>
  );
  const companySelect = (
    <select className="mf-input" aria-label="Company" data-testid="meeting-company" value={d.companyId} onChange={(e) => setCompany(e.target.value)}>
      <option value="" disabled>
        Pick a company
      </option>
      {companies.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const dealSelect =
    d.companyId && deals.length === 0 ? (
      <span className="meeting-no-deals" data-testid="meeting-no-deals">
        <span className="meeting-muted">This company has no deals yet</span>
        <button type="button" className="btn-plain" data-testid="meeting-new-deal" onClick={newDeal}>
          + New deal
        </button>
      </span>
    ) : (
      <select className="mf-input" aria-label="Deal" data-testid="meeting-deal" value={d.dealId} onChange={(e) => setDeal(e.target.value)} disabled={!d.companyId}>
        <option value="" disabled>
          {d.companyId ? 'Pick a deal' : 'Pick a company first'}
        </option>
        {deals.map((l) => (
          <option key={l.id} value={l.id}>
            {(l.title || l.company) + (l.outcome === 'open' ? '' : l.outcome === 'won' ? ' · won' : ' · lost')}
          </option>
        ))}
      </select>
    );
  const location = (
    <input className="mf-input" aria-label="Location" data-testid="meeting-location" value={d.location} maxLength={320} placeholder={d.type === 'online' ? 'Add a meeting link' : 'Add location'} onChange={(e) => patch({ location: e.target.value, locationTouched: true })} />
  );
  const organizer = (
    <select className="mf-input" aria-label="Organizer" title="Organizer" data-testid="meeting-organizer" value={d.organizer} onChange={(e) => patch({ organizer: e.target.value, internal: d.internal.filter((id) => id !== e.target.value) })}>
      {!d.organizer && <option value="">Pick the organizer</option>}
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
  const agenda = (
    <textarea className="mf-input mf-agenda" aria-label="Agenda" data-testid="meeting-agenda" rows={variant === 'quick' ? 2 : 5} value={d.agenda} maxLength={5200} placeholder="Add agenda" onChange={(e) => patch({ agenda: e.target.value })} />
  );
  const notes = (
    <>
      {overlaps.length > 0 && (
        <div className="meeting-warning" data-testid="meeting-overlap">
          {overlaps.map((o) => (
            <div key={o}>{o}</div>
          ))}
        </div>
      )}
      {warnNoExternal && (
        <div className="meeting-warning" data-testid="meeting-no-external">
          A customer visit without anyone from the customer. Add a guest from {companyName}, or save it like this.
        </div>
      )}
      {tried && invalid && (
        <div className="meeting-error-box" data-testid="meeting-errors">
          {Object.values(errors).map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {failure && (
        <div className="meeting-error-box" data-testid="meeting-failure">
          Not saved: {failure}
        </div>
      )}
    </>
  );
  const saveButton = (
    <button type="button" className="btn btn-primary" data-testid="meeting-save" disabled={busy} onClick={() => void save()}>
      {busy ? 'Saving' : warnNoExternal ? 'Save anyway' : (submitLabel ?? 'Save')}
    </button>
  );

  if (variant === 'quick')
    return (
      <div className="meeting-form mf-quick" data-testid="meeting-form">
        <div className="cal-quick-head">
          {titleInput}
          {onClose && (
            <button type="button" className="icon-round" aria-label="Discard" data-testid="quick-close" onClick={onClose} style={{ width: 28, height: 28, flex: '0 0 28px' }}>
              <XIcon size={13} />
            </button>
          )}
        </div>
        {shown('title')}
        {types}
        <Row icon="clock" label="Date and time">
          {when}
          {timeError}
        </Row>
        <Row icon="team" label="Guests">
          {guestsField}
        </Row>
        <Row icon="location" label="Location">
          {location}
        </Row>
        <Row icon="agenda" label="Agenda">
          {agenda}
        </Row>
        <Row icon="owner" label="Organizer">
          {organizer}
        </Row>
        <Row icon="company" label="Company">
          {companySelect}
        </Row>
        <Row icon="value" label="Deal">
          {dealSelect}
        </Row>
        {notes}
        <div className="cal-quick-actions">
          <button type="button" className="btn-plain" data-testid="quick-more" onClick={more}>
            More options
          </button>
          {saveButton}
        </div>
      </div>
    );

  return (
    <div className={'meeting-form mf-' + variant} data-testid="meeting-form">
      <div className="mf-head">
        {onClose && (
          <button type="button" className="icon-round mf-close" aria-label="Close" data-testid="meeting-close" onClick={onClose}>
            <XIcon size={15} />
          </button>
        )}
        <div className="mf-head-main">
          {titleInput}
          {shown('title')}
          {when}
          {timeError}
          {types}
        </div>
        {variant === 'page' && <div className="mf-head-save">{saveButton}</div>}
      </div>
      <div className="mf-cols">
        <section className="mf-details" aria-label="Meeting details">
          <div className="mf-col-title">Meeting details</div>
          <Row icon="company" label="Company">
            {companySelect}
            {shown('company')}
          </Row>
          <Row icon="value" label="Deal">
            {dealSelect}
            {shown('deal')}
          </Row>
          <Row icon="location" label="Location">
            {location}
            {shown('location')}
          </Row>
          <Row icon="owner" label="Organizer">
            {organizer}
            {shown('organizer')}
          </Row>
          <Row icon="agenda" label="Agenda">
            {agenda}
            {shown('agenda')}
          </Row>
        </section>
        <section className="mf-guests" aria-label="Guests">
          <div className="mf-col-title">Guests</div>
          {guestsField}
        </section>
      </div>
      {notes}
      {variant === 'inline' && <div className="mf-actions">{saveButton}</div>}
    </div>
  );
}

/** A row of the form: an icon (its name on hover and for screen readers), then the field. */
function Row({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="mf-row" data-label={label}>
      <span className="mf-icon" title={label}>
        <Icon name={icon} title={label} />
      </span>
      <div className="mf-row-body">{children}</div>
    </div>
  );
}
