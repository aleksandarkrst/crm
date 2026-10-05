import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconRow } from '../../components/icons';
import { Section } from '../../components/RecordParts';
import { RichText } from '../../components/RichText';
import { Avatar, Picker, PickerRow, RemoveButton, usePicker } from '../../components/ui';
import type { ApiMeeting, ApiMeetingParticipant, MeetingInput, MeetingType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { hasEmail, locationUrl, MEETING_TYPES } from '../../store/meetings';
import { allPeople, companyIdOfPerson, companyLabels, companyRecords, initialsOf, memberLabels, memberName } from '../../store/selectors';
import { useStore } from '../../store/store';
import { instantToZoned, zonedToInstant } from '../../store/time';

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
 * The meeting's details, each edited in place (CD-212, spec 4.5): type, time, location, company
 * and deal, organizer (owners and admins pick another one, spec 5.3), the internal and external
 * participants (contacts of the meeting's company) and the agenda. Read-only for people who can't
 * change the meeting, and while it is cancelled.
 */
export function MeetingFields({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  return (
    <>
      <DetailsCard m={m} editable={editable} />
      <InternalCard m={m} editable={editable} />
      <ExternalCard m={m} editable={editable} />
      <AgendaCard m={m} editable={editable} />
    </>
  );
}

function DetailsCard({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { s, set, session, flash } = useStore();
  const save = useSave(m);
  const tz = s.workspace.timezone;
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';

  // Type: saved at once.
  const type = useField(m.type, (v) => save({ type: v as MeetingType }, 'the type'), 0);

  // Time: start and end together ("startIso|endIso"); a new start keeps the length.
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
  const a = instantToZoned(startIso, tz);
  const b = instantToZoned(endIso, tz);
  const length = Date.parse(endIso) - Date.parse(startIso);
  const setStart = (date: string, time: string) => {
    if (!date || !time) return;
    const start = zonedToInstant(date, time, tz);
    if (Number.isFinite(start)) when.change(`${new Date(start).toISOString()}|${new Date(start + length).toISOString()}`);
  };
  const setEnd = (date: string, time: string) => {
    if (!date || !time) return;
    const end = zonedToInstant(date, time, tz);
    if (Number.isFinite(end)) when.change(`${startIso}|${new Date(end).toISOString()}`);
  };

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

  return (
    <Section title="Details" testId="meeting-details">
      <IconRow icon="note" label="Type">
        <select className="ghost" aria-label="Type" data-testid="meeting-field-type" value={type.draft} disabled={!editable} onChange={(e) => type.change(e.target.value)}>
          {MEETING_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </IconRow>
      <IconRow icon="calendar" label="When">
        <span className="meeting-field-when" data-testid="meeting-field-when">
          <input type="date" className="ghost" aria-label="Start date" data-testid="meeting-field-date" value={a.date} disabled={!editable} onChange={(e) => setStart(e.target.value, a.time)} onBlur={() => void when.flush()} />
          <input type="time" className="ghost" aria-label="Starts" data-testid="meeting-field-start" step={300} value={a.time} disabled={!editable} onChange={(e) => setStart(a.date, e.target.value)} onBlur={() => void when.flush()} />
          <span aria-hidden>–</span>
          {b.date !== a.date && (
            <input type="date" className="ghost" aria-label="End date" data-testid="meeting-field-end-date" value={b.date} disabled={!editable} onChange={(e) => setEnd(e.target.value, b.time)} onBlur={() => void when.flush()} />
          )}
          <input type="time" className="ghost" aria-label="Ends" data-testid="meeting-field-end" step={300} value={b.time} disabled={!editable} onChange={(e) => setEnd(b.date, e.target.value)} onBlur={() => void when.flush()} />
        </span>
      </IconRow>
      <IconRow icon="location" label="Location">
        <input
          className="ghost"
          aria-label="Location"
          data-testid="meeting-field-location"
          maxLength={320}
          placeholder={editable ? (type.draft === 'online' ? 'Meeting link' : 'Address') : 'No location'}
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
    </Section>
  );
}

function InternalCard({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { s } = useStore();
  const save = useSave(m);
  const internal = m.participants.filter((p) => p.kind === 'internal');
  const ids = internal.filter((p) => p.userId && !p.deleted && p.userId !== m.organizerUserId).map((p) => p.userId!);
  const members = [...memberLabels(s)].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  const [busy, setBusy] = useState(false);
  const setPeople = async (next: string[], what: string) => {
    setBusy(true);
    await save({ internalUserIds: next }, what);
    setBusy(false);
  };
  return (
    <Section title={`Internal participants (${internal.length})`} testId="meeting-internal-list">
      {internal.map((p) => (
        <Person
          key={p.id}
          p={p}
          label={p.userId === m.organizerUserId ? 'organizer' : undefined}
          onRemove={editable && p.userId && p.userId !== m.organizerUserId && !busy ? () => void setPeople(ids.filter((id) => id !== p.userId), `removing ${p.name}`) : undefined}
        />
      ))}
      {editable && (
        <select className="form-input meeting-add" aria-label="Add a colleague" data-testid="meeting-field-add-internal" value="" disabled={busy} onChange={(e) => e.target.value && void setPeople([...ids, e.target.value], 'the new participant')}>
          <option value="">+ Add a colleague</option>
          {members
            .filter((x) => x.id !== m.organizerUserId && !ids.includes(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      )}
    </Section>
  );
}

function ExternalCard({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { s, createContact } = useStore();
  const save = useSave(m);
  const picker = usePicker();
  const external = m.participants.filter((p) => p.kind === 'external');
  const ids = external.filter((p) => p.contactId && !p.deleted).map((p) => p.contactId!);
  const [busy, setBusy] = useState(false);
  const [newContact, setNewContact] = useState<{ name: string; email: string } | null>(null);
  const setPeople = async (next: string[], what: string) => {
    setBusy(true);
    await save({ externalContactIds: next }, what);
    setBusy(false);
  };
  // Only the meeting company's contacts (CD-212).
  const q = picker.search.trim().toLowerCase();
  const seen = new Set<string>();
  const candidates = allPeople(s)
    .filter((p) => p.contactId && !seen.has(p.contactId) && !!seen.add(p.contactId))
    .filter((p) => companyIdOfPerson(s, p) === m.companyId && !ids.includes(p.contactId!))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
    .sort((x, y) => x.name.localeCompare(y.name))
    .slice(0, 60);
  const addContact = async () => {
    if (!newContact?.name.trim()) return;
    setBusy(true);
    const id = await createContact({ name: newContact.name.trim(), email: newContact.email.trim(), role: '', phone: '', linkedin: '', buyerRole: 'Influencer', notes: '' }, undefined, undefined, m.companyId);
    setBusy(false);
    if (!id) return; // the store said why
    setNewContact(null);
    await setPeople([...ids, id], 'the new contact');
  };

  return (
    <Section title={`External participants (${external.length})`} testId="meeting-external-list">
      {external.length === 0 && <span className="meeting-muted">Nobody from the customer.</span>}
      {external.map((p) => (
        <Person key={p.id} p={p} external onRemove={editable && p.contactId && !p.deleted && !busy ? () => void setPeople(ids.filter((id) => id !== p.contactId), `removing ${p.name}`) : undefined} />
      ))}
      {editable && (
        <div className="meeting-picker" data-testid="meeting-field-add-external">
          <Picker
            picker={picker}
            placeholder={`Add a contact of ${m.companyName}…`}
            items={
              candidates.length ? (
                candidates.map((p) => (
                  <PickerRow
                    key={p.contactId}
                    initials={p.initials || initialsOf(p.name)}
                    title={p.name}
                    subtitle={[p.role, p.email].filter((x) => x && x !== '—').join(' · ') || ' '}
                    trailing={!hasEmail(p.email) ? <span className="badge badge-neutral">No email</span> : undefined}
                    onPick={() => {
                      picker.close();
                      void setPeople([...ids, p.contactId!], p.name);
                    }}
                  />
                ))
              ) : (
                <div style={{ padding: 8, fontSize: 12.5, color: 'var(--muted)' }}>{q ? `No contact of ${m.companyName} matches.` : `No more contacts at ${m.companyName}.`}</div>
              )
            }
            footer={
              <button
                type="button"
                className="meeting-picker-add"
                data-testid="meeting-field-new-contact"
                onClick={() => {
                  setNewContact({ name: picker.search.trim(), email: '' });
                  picker.close();
                }}
              >
                + Add new contact at {m.companyName}
              </button>
            }
          />
        </div>
      )}
      {newContact && (
        <div className="meeting-new-contact" data-testid="meeting-field-new-contact-form">
          <div className="meeting-form-grid">
            <label className="form-label">
              Full name
              <input className="form-input" autoFocus value={newContact.name} maxLength={200} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
            </label>
            <label className="form-label">
              Email
              <input className="form-input" type="email" value={newContact.email} placeholder="Optional" onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
            </label>
          </div>
          <div className="meeting-new-contact-actions">
            <span className="meeting-muted">Saved as a contact of {m.companyName}.</span>
            <button type="button" className="btn btn-secondary" onClick={() => setNewContact(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!newContact.name.trim() || busy} onClick={() => void addContact()}>
              {busy ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function AgendaCard({ m, editable }: { m: ApiMeeting; editable: boolean }) {
  const { flash } = useStore();
  const save = useSave(m);
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
    <Section title="Agenda" testId="meeting-agenda-view">
      {editable ? (
        <textarea
          className="ghost meeting-agenda-input"
          aria-label="Agenda"
          data-testid="meeting-field-agenda"
          maxLength={5200}
          placeholder="What you want to cover"
          value={agenda.draft}
          onChange={(e) => agenda.change(e.target.value)}
          onBlur={() => void agenda.flush()}
        />
      ) : m.agenda ? (
        <RichText text={m.agenda} />
      ) : (
        <span className="meeting-muted">No agenda.</span>
      )}
    </Section>
  );
}

function Person({ p, label, external, onRemove }: { p: ApiMeetingParticipant; label?: string; external?: boolean; onRemove?: () => void }) {
  // A deleted contact, or a member who left the workspace (they stay on past meetings, CD-131).
  const name = p.deleted ? `${p.name} (${p.kind === 'internal' ? 'former member' : 'deleted'})` : p.name;
  const body = (
    <>
      <Avatar initials={initialsOf(p.name)} size={26} font={10} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: p.deleted ? 'var(--muted)' : undefined }}>{name}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[label, external ? (hasEmail(p.email) ? p.email : 'No email') : null].filter(Boolean).join(' · ')}</span>
      </span>
    </>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-testid="meeting-person">
      {external && p.contactId && !p.deleted ? (
        <Link to={paths.contact(p.contactId)} className="meeting-person-row" style={{ flex: 1, minWidth: 0 }}>
          {body}
        </Link>
      ) : (
        <div className="meeting-person-row" style={{ flex: 1, minWidth: 0 }}>
          {body}
        </div>
      )}
      {onRemove && <RemoveButton box={24} size={13} title={`Remove ${p.name}`} onClick={onRemove} />}
    </div>
  );
}
