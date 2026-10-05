import { useEffect, useMemo, useState } from 'react';
import { Avatar, Modal, ModalHeader, Picker, PickerRow, RemoveButton, usePicker } from '../components/ui';
import type { ApiMeeting, MeetingInput, MeetingType } from '../lib/api';
import { hasEmail, MEETING_TYPES, type MeetingDialogSeed } from '../store/meetings';
import { allPeople, companyIdOfPerson, companyLabels, companyRecords, initialsOf, memberLabels } from '../store/selectors';
import { useStore } from '../store/store';
import { instantToZoned, timeLabel, todayIn, zonedToInstant } from '../store/time';

const DURATIONS = [15, 30, 45, 60, 90];
const MINUTE = 60_000;

/** The New / Edit meeting dialog (CD-130), opened with `meetings.openDialog(seed)` from anywhere. */
export function MeetingDialog() {
  const { s, meetings } = useStore();
  const seed = s.meetingDialog;
  if (!seed) return null;
  const editing = seed.id ? s.meetings[seed.id] : undefined;
  return (
    <Modal maxWidth={720} gap={16}>
      <ModalHeader title={editing ? 'Edit meeting' : 'New meeting'} sub={editing ? `${editing.companyName} · changes are saved for everyone on the meeting.` : 'Every meeting belongs to a customer company. Times are in the workspace time zone (' + s.workspace.timezone + ').'} />
      <MeetingForm seed={seed} onDone={() => meetings.closeDialog()} onCancel={() => meetings.closeDialog()} />
    </Modal>
  );
}

interface Draft {
  title: string;
  /** The title follows the company ("Meeting with …") until it is typed in. */
  titleTouched: boolean;
  type: MeetingType;
  date: string;
  time: string;
  /** Minutes from start to end; the end moves with the start. */
  duration: number;
  location: string;
  locationTouched: boolean;
  companyId: string;
  dealId: string;
  organizer: string;
  internal: string[];
  external: string[];
  agenda: string;
}

/**
 * The meeting form (spec 4.2): in the dialog, and inline in the deal's Composer (Meeting tab) with
 * `submitLabel` "Schedule meeting". `onDone` gets the saved meeting.
 */
export function MeetingForm({ seed, onDone, onCancel, submitLabel }: { seed: MeetingDialogSeed; onDone: (m: ApiMeeting) => void; onCancel?: () => void; submitLabel?: string }) {
  const { s, session, meetings, flash } = useStore();
  const tz = s.workspace.timezone;
  const editing = seed.id ? s.meetings[seed.id] : undefined;
  const records = useMemo(() => companyRecords(s), [s]);
  const labels = useMemo(() => companyLabels(records), [records]);
  const people = useMemo(() => {
    const seen = new Set<string>();
    return allPeople(s).filter((p) => p.contactId && !seen.has(p.contactId) && seen.add(p.contactId));
  }, [s]);
  const members = useMemo(() => [...memberLabels(s)].map(([id, name]) => ({ id, name })), [s]);

  const [d, setD] = useState<Draft>(() => initialDraft());
  function initialDraft(): Draft {
    if (editing) {
      const a = instantToZoned(editing.startsAt, tz);
      return {
        title: editing.title,
        titleTouched: true,
        type: editing.type,
        date: a.date,
        time: a.time,
        duration: Math.round((Date.parse(editing.endsAt) - Date.parse(editing.startsAt)) / MINUTE),
        location: editing.location ?? '',
        locationTouched: true,
        companyId: editing.companyId,
        dealId: editing.dealId ?? '',
        organizer: editing.organizerUserId ?? '',
        internal: editing.participants.filter((p) => p.kind === 'internal' && p.userId && p.userId !== editing.organizerUserId && !p.deleted).map((p) => p.userId!),
        external: editing.participants.filter((p) => p.kind === 'external' && p.contactId && !p.deleted).map((p) => p.contactId!),
        agenda: editing.agenda ?? '',
      };
    }
    const person = seed.contactId ? people.find((p) => p.contactId === seed.contactId || p.id === seed.contactId) : undefined;
    const deal = seed.dealId ? s.leads.find((l) => l.id === seed.dealId) : undefined;
    const companyId = seed.companyId || deal?.companyId || (person ? companyIdOfPerson(s, person) : null) || '';
    const openDeals = s.leads.filter((l) => l.companyId === companyId && l.outcome === 'open');
    const dealId = deal && deal.companyId === companyId ? deal.id : openDeals.length === 1 ? openDeals[0]!.id : '';
    // From a deal: its primary contact; from a contact: that contact.
    const contactId = person?.contactId ?? (deal?.contactId || '');
    let date: string;
    let time: string;
    if (seed.start) ({ date, time } = instantToZoned(seed.start, tz));
    else {
      // The next full hour today.
      const now = instantToZoned(Date.now(), tz);
      const next = Math.min(23 * 60, (Math.floor(now.minutes / 60) + 1) * 60);
      date = todayIn(tz);
      time = `${String(Math.floor(next / 60)).padStart(2, '0')}:00`;
    }
    const type = seed.type ?? 'visit';
    const co = records.find((c) => c.id === companyId);
    return {
      title: co ? `Meeting with ${co.name}` : '',
      titleTouched: false,
      type,
      date,
      time,
      duration: 60,
      location: type === 'visit' ? hqOf(co?.hq) : '',
      locationTouched: false,
      companyId,
      dealId,
      organizer: seed.organizerUserId || session.userId,
      internal: [],
      external: contactId ? [contactId] : [],
      agenda: '',
    };
  }

  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [noExternalOk, setNoExternalOk] = useState(false);
  const [overlaps, setOverlaps] = useState<string[]>([]);
  const contactPicker = usePicker();

  const company = records.find((c) => c.id === d.companyId);
  const startMs = d.date && d.time ? zonedToInstant(d.date, d.time, tz) : NaN;
  const endMs = startMs + d.duration * MINUTE;
  const end = Number.isFinite(endMs) ? instantToZoned(endMs, tz) : { date: d.date, time: '' };
  const deals = s.leads.filter((l) => l.companyId === d.companyId).sort((a, b) => Number(b.outcome === 'open') - Number(a.outcome === 'open'));
  const chosenDeal = s.leads.find((l) => l.id === d.dealId);
  const readOnly = editing?.status === 'cancelled';

  const patch = (p: Partial<Draft>) => {
    setD((x) => ({ ...x, ...p }));
    setFailure('');
  };
  const setCompany = (companyId: string) => {
    const co = records.find((c) => c.id === companyId);
    const open = s.leads.filter((l) => l.companyId === companyId && l.outcome === 'open');
    setD((x) => ({
      ...x,
      companyId,
      dealId: open.length === 1 ? open[0]!.id : '',
      title: x.titleTouched ? x.title : co ? `Meeting with ${co.name}` : '',
      location: x.locationTouched || x.type !== 'visit' ? x.location : hqOf(co?.hq),
    }));
  };
  const setType = (type: MeetingType) => setD((x) => ({ ...x, type, location: x.locationTouched ? x.location : type === 'visit' ? hqOf(company?.hq) : '' }));
  const setEnd = (date: string, time: string) => {
    if (!date || !time || !Number.isFinite(startMs)) return;
    patch({ duration: Math.round((zonedToInstant(date, time, tz) - startMs) / MINUTE) });
  };

  // "Ana has another meeting at 10:00": the chosen colleagues' other meetings at that time (never blocks saving).
  const people4 = [d.organizer, ...d.internal].filter(Boolean).join(',');
  const startIso = Number.isFinite(startMs) ? new Date(startMs).toISOString() : '';
  const endIso = Number.isFinite(endMs) && d.duration > 0 ? new Date(endMs).toISOString() : '';
  const findOverlaps = meetings.findOverlaps;
  useEffect(() => {
    if (!people4 || !startIso || !endIso || readOnly) return;
    let alive = true;
    const t = setTimeout(() => {
      findOverlaps(people4.split(','), startIso, endIso, seed.id).then(
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
  }, [people4, startIso, endIso, seed.id, tz, readOnly]);

  // ------------------------------------------------------------ validation (AC 6)
  const errors: Partial<Record<'title' | 'time' | 'company' | 'organizer' | 'deal' | 'location' | 'agenda', string>> = {};
  if (!d.title.trim()) errors.title = 'Give the meeting a title.';
  else if (d.title.trim().length > 200) errors.title = 'The title can be at most 200 characters.';
  if (!d.date || !d.time || !Number.isFinite(startMs)) errors.time = 'Pick a start date and time.';
  else if (d.duration <= 0) errors.time = 'The end must be after the start.';
  if (!d.companyId) errors.company = 'Pick the customer company.';
  if (!d.organizer) errors.organizer = 'Pick an organizer.';
  if (chosenDeal && chosenDeal.companyId !== d.companyId) errors.deal = 'That deal belongs to another company.';
  if (d.location.length > 300) errors.location = 'The location can be at most 300 characters.';
  if (d.agenda.length > 5000) errors.agenda = 'The agenda can be at most 5,000 characters.';
  const invalid = Object.keys(errors).length > 0;
  const shown = (k: keyof typeof errors) => (tried && errors[k] ? <span className="meeting-error">{errors[k]}</span> : null);
  // A Customer visit without anyone from the customer: warn once on saving. An edit that leaves it as it was saved doesn't warn again.
  const keptAsSaved = !!editing && editing.type === 'visit' && !editing.participants.some((p) => p.kind === 'external' && !p.deleted);
  const needsExternalWarning = d.type === 'visit' && d.external.length === 0 && !noExternalOk && !keptAsSaved;

  const save = async () => {
    setTried(true);
    if (invalid || readOnly) return;
    if (needsExternalWarning) {
      setNoExternalOk(true); // the warning shows; the next click saves
      return;
    }
    const input = {
      title: d.title.trim(),
      type: d.type,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      location: d.location.trim() || null,
      agenda: d.agenda.trim() || null,
      companyId: d.companyId,
      dealId: d.dealId || null,
      organizerUserId: d.organizer,
      internalUserIds: d.internal.filter((id) => id !== d.organizer),
      externalContactIds: d.external,
    };
    setBusy(true);
    try {
      let saved: ApiMeeting;
      if (editing) {
        const before = initialDraft();
        const body: MeetingInput = {};
        if (input.title !== editing.title) body.title = input.title;
        if (input.type !== editing.type) body.type = input.type;
        if (Date.parse(input.startsAt) !== Date.parse(editing.startsAt)) body.startsAt = input.startsAt;
        if (Date.parse(input.endsAt) !== Date.parse(editing.endsAt)) body.endsAt = input.endsAt;
        if (input.location !== (editing.location ?? null)) body.location = input.location;
        if (input.agenda !== (editing.agenda ?? null)) body.agenda = input.agenda;
        if (input.companyId !== editing.companyId) body.companyId = input.companyId;
        if (input.dealId !== (editing.dealId ?? null)) body.dealId = input.dealId;
        if (input.organizerUserId !== (editing.organizerUserId ?? '')) body.organizerUserId = input.organizerUserId;
        if (!sameSet(input.internalUserIds, before.internal) || body.organizerUserId) body.internalUserIds = input.internalUserIds;
        if (!sameSet(input.externalContactIds, before.external)) body.externalContactIds = input.externalContactIds;
        saved = Object.keys(body).length ? await meetings.update(editing.id, body, editing.updatedAt) : editing;
        flash('Meeting saved');
      } else {
        saved = await meetings.create(input);
        flash(`${saved.title} scheduled`);
      }
      onDone(saved);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // External participants: the company's contacts first, then everyone (spec 5.2).
  const q = contactPicker.search.trim().toLowerCase();
  const candidates = people
    .filter((p) => !d.external.includes(p.contactId!))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
    .sort((a, b) => Number(companyIdOfPerson(s, b) === d.companyId) - Number(companyIdOfPerson(s, a) === d.companyId) || a.name.localeCompare(b.name))
    .slice(0, 60);
  const personOf = (contactId: string) => people.find((p) => p.contactId === contactId);
  const companies = records.map((c) => ({ value: c.id, label: labels.get(c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  const organizerOptions = [...members];
  const deletedExternal = editing?.participants.filter((p) => p.kind === 'external' && p.deleted) ?? [];

  return (
    <div className="meeting-form" data-testid="meeting-form">
      {readOnly && <div className="hint-box">This meeting is cancelled. Restore it on its page to change it.</div>}
      <label className="form-label">
        Title
        <input className="form-input" data-testid="meeting-title" value={d.title} maxLength={220} placeholder="Meeting with …" onChange={(e) => patch({ title: e.target.value, titleTouched: true })} />
        {shown('title')}
      </label>
      <div className="meeting-form-grid">
        <label className="form-label">
          Company
          <select className="form-input" data-testid="meeting-company" value={d.companyId} onChange={(e) => setCompany(e.target.value)}>
            <option value="" disabled>
              Pick a company…
            </option>
            {companies.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {shown('company')}
        </label>
        <label className="form-label">
          Deal
          <select className="form-input" data-testid="meeting-deal" value={d.dealId} onChange={(e) => patch({ dealId: e.target.value })} disabled={!d.companyId}>
            <option value="">No deal</option>
            {deals.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.title || l.company) + (l.outcome === 'open' ? '' : l.outcome === 'won' ? ' · won' : ' · lost')}
              </option>
            ))}
          </select>
          {shown('deal')}
        </label>
        <label className="form-label">
          Type
          <select className="form-input" data-testid="meeting-type" value={d.type} onChange={(e) => setType(e.target.value as MeetingType)}>
            {MEETING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Organizer
          <select className="form-input" data-testid="meeting-organizer" value={d.organizer} onChange={(e) => patch({ organizer: e.target.value, internal: d.internal.filter((id) => id !== e.target.value) })}>
            {!d.organizer && <option value="">Organizer left · pick a new one</option>}
            {organizerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {shown('organizer')}
        </label>
        <label className="form-label">
          Starts
          <span className="meeting-when">
            <input type="date" className="form-input" data-testid="meeting-date" value={d.date} onChange={(e) => patch({ date: e.target.value })} />
            <input type="time" className="form-input" data-testid="meeting-start" step={300} value={d.time} onChange={(e) => patch({ time: e.target.value })} />
          </span>
        </label>
        <label className="form-label">
          Ends
          <span className="meeting-when">
            <input type="date" className="form-input" data-testid="meeting-end-date" value={end.date} onChange={(e) => setEnd(e.target.value, end.time)} />
            <input type="time" className="form-input" data-testid="meeting-end" step={300} value={end.time} onChange={(e) => setEnd(end.date, e.target.value)} />
          </span>
        </label>
      </div>
      <div className="meeting-durations" role="group" aria-label="Duration">
        {DURATIONS.map((n) => (
          <button key={n} type="button" className={d.duration === n ? 'choice-pill on' : 'choice-pill'} data-testid={'meeting-duration-' + n} onClick={() => patch({ duration: n })}>
            {n} min
          </button>
        ))}
        {shown('time')}
      </div>
      <label className="form-label">
        Location
        <input className="form-input" data-testid="meeting-location" value={d.location} maxLength={320} placeholder={d.type === 'online' ? 'Meeting link' : 'Address'} onChange={(e) => patch({ location: e.target.value, locationTouched: true })} />
        {shown('location')}
      </label>

      <div className="form-label">
        Internal participants
        <div className="meeting-people" data-testid="meeting-internal">
          <span className="meeting-person">
            <Avatar initials={initialsOf(members.find((m) => m.id === d.organizer)?.name ?? '?')} size={20} font={9} />
            {members.find((m) => m.id === d.organizer)?.name ?? 'Organizer left'} <span className="meeting-muted">organizer</span>
          </span>
          {d.internal.map((id) => (
            <span key={id} className="meeting-person">
              <Avatar initials={initialsOf(members.find((m) => m.id === id)?.name ?? '?')} size={20} font={9} />
              {members.find((m) => m.id === id)?.name ?? 'Former member'}
              <RemoveButton box={20} size={12} title="Remove" onClick={() => patch({ internal: d.internal.filter((x) => x !== id) })} />
            </span>
          ))}
          <select className="form-input meeting-add" aria-label="Add a colleague" data-testid="meeting-add-internal" value="" onChange={(e) => e.target.value && patch({ internal: [...d.internal, e.target.value] })}>
            <option value="">+ Add a colleague</option>
            {members
              .filter((m) => m.id !== d.organizer && !d.internal.includes(m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="form-label">
        External participants
        <div className="meeting-people" data-testid="meeting-external">
          {d.external.map((id) => {
            const p = personOf(id);
            return (
              <span key={id} className="meeting-person">
                <Avatar initials={initialsOf(p?.name ?? '?')} size={20} font={9} />
                {p?.name ?? 'Contact'}
                {!hasEmail(p?.email) && <span className="meeting-muted">No email</span>}
                <RemoveButton box={20} size={12} title="Remove" onClick={() => patch({ external: d.external.filter((x) => x !== id) })} />
              </span>
            );
          })}
          {deletedExternal.map((p) => (
            <span key={p.id} className="meeting-person meeting-muted">
              {p.name} (deleted)
            </span>
          ))}
        </div>
        <div className="meeting-picker">
          <Picker
            picker={contactPicker}
            placeholder="Add a contact…"
            items={
              candidates.length ? (
                candidates.map((p) => (
                  <PickerRow
                    key={p.contactId}
                    initials={p.initials || initialsOf(p.name)}
                    title={p.name}
                    subtitle={[p.company, p.role].filter((x) => x && x !== '—').join(' · ') || ' '}
                    trailing={!hasEmail(p.email) ? <span className="badge badge-neutral">No email</span> : undefined}
                    onPick={() => {
                      patch({ external: [...d.external, p.contactId!] });
                      contactPicker.close();
                    }}
                  />
                ))
              ) : (
                <div style={{ padding: 8, fontSize: 12.5, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>No contacts match.</div>
              )
            }
          />
        </div>
      </div>

      <label className="form-label">
        Agenda
        <textarea className="form-input" data-testid="meeting-agenda" rows={3} value={d.agenda} maxLength={5200} placeholder="What you want to cover" onChange={(e) => patch({ agenda: e.target.value })} />
        {shown('agenda')}
      </label>

      {overlaps.length > 0 && (
        <div className="meeting-warning" data-testid="meeting-overlap">
          {overlaps.map((o) => (
            <div key={o}>{o}</div>
          ))}
        </div>
      )}
      {noExternalOk && d.type === 'visit' && d.external.length === 0 && (
        <div className="meeting-warning" data-testid="meeting-no-external">
          A customer visit without anyone from the customer. Add an external participant, or save it like this.
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
      <div className="modal-actions">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn btn-primary" data-testid="meeting-save" disabled={busy || readOnly} onClick={() => void save()}>
          {busy ? 'Saving…' : noExternalOk && d.type === 'visit' && d.external.length === 0 ? 'Save anyway' : (submitLabel ?? (editing ? 'Save meeting' : 'Create meeting'))}
        </button>
      </div>
    </div>
  );
}

const hqOf = (hq: string | undefined) => (hq && hq !== '—' ? hq : '');
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
