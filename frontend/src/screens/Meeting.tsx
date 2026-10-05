import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { Section } from '../components/RecordParts';
import { RichText } from '../components/RichText';
import { Avatar, Modal, ModalHeader } from '../components/ui';
import type { ApiMeeting, ApiMeetingParticipant } from '../lib/api';
import { paths } from '../lib/paths';
import { hasEmail, locationUrl } from '../store/meetings';
import { initialsOf, memberLabels, memberName } from '../store/selectors';
import { useStore } from '../store/store';
import { instantToZoned, spanLabel, timeLabel } from '../store/time';
import { useMeeting } from '../store/useMeetings';
import { StatusBadge, TypeTag } from './calendar/parts';
import { ExternalMinutes } from './meeting/ExternalMinutes';
import { InternalMinutes } from './meeting/InternalMinutes';
import { MeetingHistory } from './meeting/MeetingHistory';

type Tab = 'internal' | 'external' | 'history';
const TABS: { value: Tab; label: string }[] = [
  { value: 'internal', label: 'Internal minutes' },
  { value: 'external', label: 'External minutes' },
  { value: 'history', label: 'History' },
];

/**
 * One meeting (CD-130, spec 4.5), opened from any Calendar view or a meeting link: its details,
 * status actions, and tabs for the minutes and the history. A cancelled meeting is read-only
 * until restored.
 */
export function Meeting() {
  const { id = '' } = useParams();
  const m = useMeeting(id);
  return (
    <Screen title="Meeting" parent={{ label: 'Calendar', to: paths.calendar() }}>
      {m === undefined ? (
        <div className="empty-state">Loading the meeting…</div>
      ) : m === 'error' ? (
        <div className="empty-state">Couldn't load the meeting. It will load when the connection is back.</div>
      ) : m === null ? (
        <div className="empty-block" data-testid="meeting-missing">
          <div className="empty-block-title">This meeting doesn't exist</div>
          <div className="empty-block-text">It may have been deleted.</div>
          <div className="empty-block-actions">
            <Link className="btn btn-primary" to={paths.calendar()}>
              Open the calendar
            </Link>
          </div>
        </div>
      ) : (
        <MeetingPage key={m.id} m={m} />
      )}
    </Screen>
  );
}

function MeetingPage({ m }: { m: ApiMeeting }) {
  const { s, meetings } = useStore();
  const navigate = useNavigate();
  const tz = s.workspace.timezone;
  const [tab, setTab] = useState<Tab>('internal');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pickOrganizer, setPickOrganizer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);

  const canEdit = meetings.canEdit(m);
  // Minutes went to the customer (CD-133): the meeting stays held and can't be deleted.
  const sent = m.externalDelivery !== 'not_sent';
  const started = Date.parse(m.startsAt) <= Date.now();
  const url = locationUrl(m.location);
  const internal = m.participants.filter((p) => p.kind === 'internal');
  const external = m.participants.filter((p) => p.kind === 'external');
  const deal = m.dealId ? s.leads.find((l) => l.id === m.dealId) : undefined;
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };
  const onDelete = async () => {
    setMenu(false);
    if (!window.confirm(`Delete the meeting "${m.title}"? This can't be undone. To keep a record of it, cancel it instead.`)) return;
    if (await meetings.remove(m.id)) navigate(paths.calendar(), { replace: true });
  };

  return (
    <div className="meeting-page" data-testid="meeting-page" data-status={m.status}>
      <div className="card deal-header" style={{ padding: '16px 20px' }}>
        <div className="deal-crumb">
          <Link to={paths.calendar({ view: 'day', date: instantToZoned(m.startsAt, tz).date })} className="crumb-link">
            Calendar
          </Link>
          <span aria-hidden>→</span>
          <Link to={paths.company(m.companyId)} className="crumb-link">
            {m.companyName}
          </Link>
        </div>
        <div className="deal-header-top">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 300px', minWidth: 0 }}>
            <h2 className={'meeting-title' + (m.status === 'cancelled' ? ' is-cancelled' : '')} data-testid="meeting-page-title">
              {m.title}
            </h2>
            <div className="meeting-facts">
              <TypeTag type={m.type} />
              <span data-testid="meeting-status">
                <StatusBadge m={m} />
              </span>
              <span className="meeting-when-label" data-testid="meeting-when">
                <Icon name="calendar" size={14} /> {spanLabel(m.startsAt, m.endsAt, tz)}
              </span>
              {m.location && (
                <span className="meeting-when-label">
                  <Icon name="location" size={14} />{' '}
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="meeting-location-link">
                      {m.location}
                    </a>
                  ) : (
                    m.location
                  )}
                </span>
              )}
            </div>
            {m.status === 'cancelled' && (
              <div className="meeting-muted" data-testid="meeting-cancelled">
                Cancelled{m.cancelReason ? `: ${m.cancelReason}` : ''}. Restore it to change it.
              </div>
            )}
          </div>
          <div className="deal-actions">
            {canEdit && m.status === 'planned' && (
              <>
                <button
                  type="button"
                  className="btn btn-won"
                  data-testid="meeting-held"
                  disabled={!started || busy}
                  title={started ? 'The meeting took place' : `You can mark it as held once it has started (${timeLabel(m.startsAt, tz)})`}
                  onClick={() => void run(() => meetings.markHeld(m.id))}
                  style={started ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
                >
                  Mark as held
                </button>
                <button type="button" className="btn btn-secondary" data-testid="meeting-cancel" disabled={busy} onClick={() => setCancelOpen(true)}>
                  Cancel meeting
                </button>
              </>
            )}
            {canEdit && m.status === 'held' && !sent && (
              <button type="button" className="btn btn-secondary" data-testid="meeting-undo-held" disabled={busy} onClick={() => void run(() => meetings.undoHeld(m.id))}>
                Undo held
              </button>
            )}
            {canEdit && m.status === 'cancelled' && (
              <button type="button" className="btn btn-primary" data-testid="meeting-restore" disabled={busy} onClick={() => void run(() => meetings.restore(m.id))}>
                Restore
              </button>
            )}
            {canEdit && m.status !== 'cancelled' && (
              <button type="button" className="btn btn-plain" data-testid="meeting-edit" onClick={() => meetings.openDialog({ id: m.id })}>
                Edit
              </button>
            )}
            {meetings.canDelete && !sent && (
              <div ref={menuRef} style={{ position: 'relative' }}>
                <button type="button" className="btn btn-secondary" aria-label="More actions" data-testid="meeting-menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)} style={{ padding: '10px 12px' }}>
                  ⋯
                </button>
                {menu && (
                  <div className="deal-menu" role="menu">
                    <button type="button" role="menuitem" data-testid="meeting-delete" onClick={() => void onDelete()}>
                      Delete meeting
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {!canEdit && <div className="meeting-muted">Only the organizer, the internal participants, owners and admins can change this meeting.</div>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', marginTop: 18 }}>
        <div className="lead-side" style={{ flex: '1 1 340px', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Section title="Details" testId="meeting-details">
            <div className="meeting-detail">
              <span className="meeting-detail-label">Company</span>
              <Link to={paths.company(m.companyId)}>{m.companyName}</Link>
            </div>
            <div className="meeting-detail">
              <span className="meeting-detail-label">Deal</span>
              {m.dealId ? <Link to={paths.lead(m.dealId)}>{deal?.title || deal?.company || m.dealTitle || 'Deal'}</Link> : <span className="meeting-muted">No deal</span>}
            </div>
            <div className="meeting-detail">
              <span className="meeting-detail-label">Organizer</span>
              {m.organizerUserId ? (
                <span>{memberName(s, m.organizerUserId, m.organizerName)}</span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-warn" data-testid="meeting-organizer-left">
                    Organizer left
                  </span>
                  {meetings.canDelete && m.status !== 'cancelled' && (
                    <button type="button" className="btn btn-plain" data-testid="meeting-pick-organizer" style={{ padding: '4px 8px' }} onClick={() => setPickOrganizer(true)}>
                      Pick new organizer
                    </button>
                  )}
                </span>
              )}
            </div>
          </Section>
          <Section title={`Internal participants (${internal.length})`} testId="meeting-internal-list">
            {internal.map((p) => (
              <Person key={p.id} p={p} label={p.userId === m.organizerUserId ? 'organizer' : undefined} />
            ))}
          </Section>
          <Section title={`External participants (${external.length})`} testId="meeting-external-list">
            {external.length === 0 && <span className="meeting-muted">Nobody from the customer.</span>}
            {external.map((p) => (
              <Person key={p.id} p={p} external />
            ))}
          </Section>
          <Section title="Agenda" testId="meeting-agenda-view">
            {m.agenda ? <RichText text={m.agenda} /> : <span className="meeting-muted">No agenda.</span>}
          </Section>
        </div>

        <div className="lead-main card" style={{ flex: '999 1 420px', minWidth: 0, overflow: 'hidden' }}>
          <div className="meeting-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} data-testid={'meeting-tab-' + t.value} className="composer-tab" onClick={() => setTab(t.value)} style={{ borderBottom: `2px solid ${tab === t.value ? 'var(--brand)' : 'transparent'}`, fontWeight: tab === t.value ? 600 : 500, color: tab === t.value ? 'var(--brand)' : 'var(--text-2)' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ padding: 18 }}>
            {tab === 'internal' && <InternalMinutes meeting={m} />}
            {tab === 'external' && <ExternalMinutes meeting={m} />}
            {tab === 'history' && <MeetingHistory meeting={m} />}
          </div>
        </div>
      </div>

      {cancelOpen && <CancelDialog m={m} onClose={() => setCancelOpen(false)} />}
      {pickOrganizer && <OrganizerDialog m={m} onClose={() => setPickOrganizer(false)} />}
    </div>
  );
}

function Person({ p, label, external }: { p: ApiMeetingParticipant; label?: string; external?: boolean }) {
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
  if (external && p.contactId && !p.deleted)
    return (
      <Link to={paths.contact(p.contactId)} className="meeting-person-row">
        {body}
      </Link>
    );
  return <div className="meeting-person-row">{body}</div>;
}

/**
 * The organizer left the workspace (CD-131, spec 5.3): an owner or admin picks a member to take
 * the meeting over. They join it as an internal participant (and get the invitation email).
 */
function OrganizerDialog({ m, onClose }: { m: ApiMeeting; onClose: () => void }) {
  const { s, meetings, flash } = useStore();
  const members = [...memberLabels(s)].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const save = async () => {
    setBusy(true);
    try {
      await meetings.update(m.id, { organizerUserId: userId }, m.updatedAt);
      flash(`${members.find((x) => x.id === userId)?.name ?? 'The new organizer'} now organizes ${m.title}`);
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader title="Pick a new organizer" sub={`${m.title}. Its organizer left the workspace.`} />
      <label className="form-label">
        Organizer
        <select className="form-input" data-testid="new-organizer" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="" disabled>
            Pick a member…
          </option>
          {members.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {failure && <div className="meeting-error-box">Not saved: {failure}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" data-testid="new-organizer-save" disabled={!userId || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save organizer'}
        </button>
      </div>
    </Modal>
  );
}

/** Cancel with an optional reason (spec 4.3). */
function CancelDialog({ m, onClose }: { m: ApiMeeting; onClose: () => void }) {
  const { meetings } = useStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title="Cancel the meeting?" sub={`${m.title}. It stays on the calendar as cancelled (hidden by default) and can be restored.`} />
      <label className="form-label">
        Reason (optional)
        <textarea className="form-input" data-testid="cancel-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The customer asked to move it to next month" />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Keep it
        </button>
        <button
          type="button"
          className="btn btn-lost"
          data-testid="cancel-confirm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await meetings.cancel(m.id, reason);
            setBusy(false);
            if (ok) onClose();
          }}
        >
          Cancel meeting
        </button>
      </div>
    </Modal>
  );
}
