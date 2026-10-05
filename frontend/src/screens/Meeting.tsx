import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { Modal, ModalHeader } from '../components/ui';
import type { ApiMeeting } from '../lib/api';
import { paths } from '../lib/paths';
import { locationUrl } from '../store/meetings';
import { useStore } from '../store/store';
import { instantToZoned, spanLabel, timeLabel } from '../store/time';
import { useMeeting } from '../store/useMeetings';
import { StatusBadge, TypeTag } from './calendar/parts';
import { ExternalMinutes } from './meeting/ExternalMinutes';
import { InternalMinutes } from './meeting/InternalMinutes';
import { MeetingFields, MeetingTitle } from './meeting/MeetingFields';
import { MeetingHistory } from './meeting/MeetingHistory';

type Tab = 'internal' | 'external' | 'history';
const TABS: { value: Tab; label: string }[] = [
  { value: 'internal', label: 'Internal minutes' },
  { value: 'external', label: 'External minutes' },
  { value: 'history', label: 'History' },
];

/**
 * One meeting (CD-130, spec 4.5), opened from any Calendar view or a meeting link: its details,
 * status actions, and tabs for the minutes and the history. Every detail is edited in place, as on
 * the deal page (CD-212, MeetingFields). A cancelled meeting is read-only until restored.
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
  // Every field is edited in place (CD-212); a cancelled meeting is read-only until restored.
  const editable = canEdit && m.status !== 'cancelled';
  // Minutes went to the customer (CD-133): the meeting stays held and can't be deleted.
  const sent = m.externalDelivery !== 'not_sent';
  const startMs = Date.parse(m.startsAt);
  const [tick, setTick] = useState(0);
  // "Mark as held" enables itself when the start passes while the page is open.
  useEffect(() => {
    const wait = startMs - Date.now();
    if (!(wait > 0)) return;
    // setTimeout holds at most ~24.8 days; a later start re-arms after the first wake-up.
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(wait + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [startMs, tick]);
  const started = startMs <= Date.now();
  const url = locationUrl(m.location);
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
            <MeetingTitle m={m} editable={editable} />
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
          <MeetingFields m={m} editable={editable} />
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
    </div>
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
