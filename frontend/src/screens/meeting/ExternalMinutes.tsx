import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import type { ApiExternalMinutes, ApiMeeting, ApiMinutesEmail, ApiMinutesSend, MinutesEmailInput } from '../../lib/api';
import { hasEmail } from '../../store/meetings';
import { useStore } from '../../store/store';
import { dateLabel, instantToZoned } from '../../store/time';
import { RichField } from './InternalMinutes';

/** Limits of the external minutes (spec 7.1; the API checks them too). */
const BODY_MAX = 10_000;
const SUBJECT_MAX = 300;
/** Typing is saved after this pause, like the internal minutes. */
const SAVE_DELAY = 700;

type Part = 'subject' | 'body';
interface Draft {
  subject: string;
  body: string;
}

/** "Mon 5 Oct 2026, 10:42" in the workspace zone. */
export const sentLabel = (at: string, tz: string) => {
  const z = instantToZoned(at, tz);
  return `${dateLabel(z.date, { year: true })}, ${z.time}`;
};
const STATUS_TEXT = { queued: 'Queued', sent: 'Sent', failed: 'Failed' } as const;
const subjectLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/**
 * The external minutes (CD-133): a text for the customer, separate from the internal minutes.
 * The first time anyone opens it, it is filled in from a template (the meeting, both sides, the
 * agreements and next steps without owners); after that only "Copy from internal minutes" copies
 * anything. It saves itself like the internal minutes. Once the meeting is held, the people who
 * may change it send it by email: tick the customer's people (those with an email), add members
 * as CC, preview the exact email, send. Below: who it was last sent to, each recipient's delivery
 * and Retry for the failed ones, and "Changed since last send".
 */
export function ExternalMinutes({ meeting }: { meeting: ApiMeeting }) {
  const { meetings } = useStore();
  const [stored, setStored] = useState<ApiExternalMinutes | null>(null);
  const [failed, setFailed] = useState(false);
  const actions = useRef(meetings);
  actions.current = meetings;

  // Read when the tab opens, and again when the text (minutesUpdatedAt) or a delivery (sendsUpdatedAt) changed.
  useEffect(() => {
    let alive = true;
    actions.current.loadExternal(meeting.id).then(
      (x) => {
        if (!alive) return;
        setStored(x);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [meeting.id, meeting.minutesUpdatedAt, meeting.sendsUpdatedAt]);

  if (!stored) {
    return (
      <div className="meeting-muted" data-testid="external-minutes-loading">
        {failed ? "Couldn't load the external minutes. They will load when the connection is back." : 'Loading the external minutes…'}
      </div>
    );
  }
  return <ExternalEditor key={meeting.id} m={meeting} stored={stored} onStored={setStored} />;
}

function ExternalEditor({ m, stored, onStored }: { m: ApiMeeting; stored: ApiExternalMinutes; onStored: (x: ApiExternalMinutes) => void }) {
  const { s, meetings } = useStore();
  const tz = s.workspace.timezone;
  const allowed = meetings.canEdit(m);
  const editable = allowed && m.status !== 'cancelled';
  const canSend = allowed && m.status === 'held';
  const [draft, setDraft] = useState<Draft>({ subject: stored.subject, body: stored.body });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const actions = useRef(meetings);
  actions.current = meetings;
  const base = useRef(stored.updatedAt);
  const dirty = useRef(new Set<Part>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);

  // Someone else's change was read: show it, unless this tab has edits not saved yet.
  useEffect(() => {
    if (dirty.current.size || timer.current || inFlight.current) return;
    setDraft({ subject: stored.subject, body: stored.body });
    base.current = stored.updatedAt;
  }, [stored]);

  /** Sends the parts changed since the last save, after the saves before it. */
  const flush = (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const parts = [...dirty.current];
    if (!parts.length) return chain.current;
    dirty.current.clear();
    const d = draftRef.current;
    const input: { subject?: string; body?: string } = {};
    if (parts.includes('subject')) input.subject = d.subject;
    if (parts.includes('body')) input.body = d.body;
    inFlight.current++;
    setState('saving');
    chain.current = chain.current.then(async () => {
      const res = await actions.current.saveExternal(m.id, input, base.current);
      inFlight.current--;
      const more = dirty.current.size > 0 || !!timer.current || inFlight.current > 0;
      if (res && 'saved' in res) {
        base.current = res.saved.updatedAt;
        onStored(res.saved);
        if (!more) setState('saved');
      } else if (res && 'conflict' in res) {
        clearTimeout(timer.current);
        timer.current = undefined;
        dirty.current.clear();
        if (res.conflict) {
          setDraft({ subject: res.conflict.subject, body: res.conflict.body });
          base.current = res.conflict.updatedAt;
          onStored(res.conflict);
        }
        setState('idle');
      } else {
        parts.forEach((p) => dirty.current.add(p));
        setState('error');
      }
    });
    return chain.current;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const change = (part: Part, value: string) => {
    setDraft((x) => {
      const d = { ...x, [part]: value };
      draftRef.current = d;
      return d;
    });
    dirty.current.add(part);
    setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY);
  };

  const [copying, setCopying] = useState(false);
  const copy = async () => {
    setCopying(true);
    const text = await actions.current.copyInternal(m.id);
    setCopying(false);
    if (text === null) return;
    if (draftRef.current.body.trim() && !window.confirm('Replace the text for the customer with the internal minutes? Your current text will be lost.')) return;
    change('body', text.slice(0, BODY_MAX));
  };

  // Recipients: the customer's people with an email are ticked; CC: members picked.
  const external = m.participants.filter((p) => p.kind === 'external');
  const reachable = external.filter((p) => p.contactId && !p.deleted && hasEmail(p.email));
  const [to, setTo] = useState<Set<string>>(() => new Set(reachable.map((p) => p.contactId!)));
  const [cc, setCc] = useState<string[]>([]);
  const members = useMemo(() => s.team.filter((t) => t.status === 'Active'), [s.team]);
  const internalIds = m.participants.flatMap((p) => (p.kind === 'internal' && p.userId && !p.deleted ? [p.userId] : []));
  const ccChoices = [...internalIds.map((id) => members.find((x) => x.id === id)).filter((x): x is (typeof members)[number] => !!x), ...members.filter((x) => !internalIds.includes(x.id) && cc.includes(x.id))];
  const others = members.filter((x) => !internalIds.includes(x.id) && !cc.includes(x.id));
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const request = (): MinutesEmailInput => ({ subject: draftRef.current.subject, body: draftRef.current.body, toContactIds: reachable.filter((p) => to.has(p.contactId!)).map((p) => p.contactId!), ccUserIds: cc });

  const [preview, setPreview] = useState<{ email: ApiMinutesEmail; input: MinutesEmailInput } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sendError, setSendError] = useState('');
  const openPreview = async () => {
    setSendError('');
    setPreviewing(true);
    await flush();
    const input = request();
    try {
      setPreview({ email: await actions.current.previewMinutes(m.id, input), input });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    }
    setPreviewing(false);
  };
  const reload = () => void actions.current.loadExternal(m.id).then(onStored, () => undefined);

  const last = stored.lastSend;
  const changed = !!last && (subjectLine(draft.subject) !== last.subject || draft.body !== last.body);
  const stateText = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : '';
  const chosen = request().toContactIds.length;
  const sendBlocked = !canSend ? (allowed ? 'Mark the meeting as held to send the minutes.' : null) : !chosen ? 'Pick at least one recipient.' : !draft.subject.trim() || !draft.body.trim() ? 'Write a subject and the minutes first.' : null;

  return (
    <div className="minutes" data-testid="external-minutes" data-meeting={m.id} data-editable={editable ? 'true' : 'false'}>
      <div className="minutes-head">
        <span className="meeting-muted">Written for the customer and sent by email. Nothing from the internal minutes is included unless you copy it in.</span>
        <span className={'minutes-state' + (state === 'error' ? ' is-error' : '')} data-testid="external-save-state" aria-live="polite">
          {stateText}
        </span>
      </div>
      {m.status === 'cancelled' && <div className="minutes-note">This meeting is cancelled, so its minutes are read-only. Restore it to change them.</div>}
      {!allowed && <div className="minutes-note">Only the organizer, the internal participants, owners and admins can write and send the minutes for the customer.</div>}
      {allowed && m.status === 'planned' && (
        <div className="minutes-note" data-testid="external-not-held">
          You can prepare the text now. Sending is possible once the meeting is marked as held.
        </div>
      )}

      <label className="minutes-field">
        <span className="form-label">Subject</span>
        {editable ? (
          <input className="form-input" data-testid="external-subject" value={draft.subject} maxLength={SUBJECT_MAX} onChange={(e) => change('subject', e.target.value)} onBlur={() => void flush()} />
        ) : (
          <span className="minutes-step-read">{draft.subject || <span className="meeting-muted">No subject.</span>}</span>
        )}
      </label>
      <RichField label="Minutes for the customer" testId="external-body" value={draft.body} max={BODY_MAX} editable={editable} placeholder="What you want the customer to read" onChange={(v) => change('body', v)} onBlur={() => void flush()} />
      {editable && (
        <button type="button" className="btn-plain minutes-add" data-testid="external-copy-internal" disabled={copying} onClick={() => void copy()}>
          {copying ? 'Copying…' : 'Copy from internal minutes'}
        </button>
      )}

      {last && (
        <div className="ext-last" data-testid="external-last-send">
          <div>
            Minutes sent to {last.recipients.filter((r) => r.kind === 'to').map((r) => r.name).join(', ')} on {sentLabel(last.createdAt, tz)}
            {changed && (
              <span className="badge badge-warn ext-changed" data-testid="external-changed">
                Changed since last send
              </span>
            )}
          </div>
          <SendStatus m={m} send={last} onRetried={reload} />
        </div>
      )}

      {canSend && (
        <div className="minutes-field" data-testid="external-recipients">
          <span className="form-label">To</span>
          {external.length === 0 && <span className="meeting-muted">This meeting has no external participants. Add the customer's people to the meeting to send them the minutes.</span>}
          <div className="ext-people">
            {external.map((p) => {
              const ok = !!p.contactId && !p.deleted && hasEmail(p.email);
              return (
                <label key={p.id} className={'ext-person' + (ok ? '' : ' is-off')} data-testid="external-to">
                  <input type="checkbox" disabled={!ok} checked={ok && to.has(p.contactId!)} onChange={() => setTo((x) => toggle(x, p.contactId!))} />
                  <span>
                    {p.name}
                    <span className="meeting-muted"> · {p.deleted ? 'deleted' : ok ? p.email : 'No email'}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <span className="form-label">Cc</span>
          <div className="ext-people">
            {ccChoices.map((x) => (
              <label key={x.id} className="ext-person" data-testid="external-cc">
                <input type="checkbox" checked={cc.includes(x.id)} onChange={() => setCc((c) => (c.includes(x.id) ? c.filter((y) => y !== x.id) : [...c, x.id]))} />
                <span>
                  {x.name}
                  <span className="meeting-muted"> · {x.email}</span>
                </span>
              </label>
            ))}
            {others.length > 0 && (
              <select className="form-input ext-add-cc" data-testid="external-add-cc" aria-label="Copy another member" value="" onChange={(e) => e.target.value && setCc((c) => [...c, e.target.value])}>
                <option value="">+ Copy another member…</option>
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
      {allowed && m.status !== 'cancelled' && (
        <div className="ext-send-row">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="external-send"
            disabled={!!sendBlocked || previewing}
            title={sendBlocked ?? 'Preview the email, then send it'}
            onClick={() => void openPreview()}
          >
            {previewing ? 'Preparing…' : last ? 'Send again…' : 'Send…'}
          </button>
          {sendBlocked && <span className="meeting-muted">{sendBlocked}</span>}
        </div>
      )}
      {sendError && <div className="meeting-error-box">{sendError}</div>}

      {preview && (
        <PreviewDialog
          m={m}
          email={preview.email}
          input={preview.input}
          onClose={() => setPreview(null)}
          onSent={() => {
            setPreview(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Each recipient of a send with its delivery, the error of a failed one, and Retry. */
export function SendStatus({ m, send, onRetried }: { m: ApiMeeting; send: ApiMinutesSend; onRetried?: () => void }) {
  const { meetings } = useStore();
  const [busy, setBusy] = useState(false);
  const anyFailed = send.recipients.some((r) => r.status === 'failed');
  return (
    <div className="ext-status" data-testid="send-status" data-status={send.status}>
      {send.recipients.map((r) => (
        <div key={r.id} className="ext-status-row" data-testid="send-recipient" data-status={r.status}>
          <span className={'badge ' + (r.status === 'failed' ? 'badge-danger' : r.status === 'sent' ? 'badge-brand' : 'badge-warn')}>{STATUS_TEXT[r.status]}</span>
          <span>
            {r.kind === 'cc' ? 'Cc ' : ''}
            {r.name} <span className="meeting-muted">{r.email}</span>
            {r.error && <span className="ext-error"> · {r.error}</span>}
          </span>
        </div>
      ))}
      {anyFailed && meetings.canEdit(m) && (
        <button
          type="button"
          className="btn btn-secondary ext-retry"
          data-testid="send-retry"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await meetings.retrySend(m.id, send.id);
            setBusy(false);
            onRetried?.();
          }}
        >
          {busy ? 'Retrying…' : 'Retry failed'}
        </button>
      )}
    </div>
  );
}

/** The exact email before it goes: from, reply-to, to, cc, subject and body. The second click sends. */
function PreviewDialog({ m, email, input, onClose, onSent }: { m: ApiMeeting; email: ApiMinutesEmail; input: MinutesEmailInput; onClose: () => void; onSent: () => void }) {
  const { meetings } = useStore();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const people = (list: { name: string; email: string }[]) => list.map((p) => `${p.name} <${p.email}>`).join(', ');
  return (
    <Modal maxWidth={680} onBackdrop={busy ? undefined : onClose}>
      <ModalHeader title="Send the minutes?" sub={`${m.title}. This is exactly what the customer will get.`} />
      <dl className="ext-preview-head" data-testid="preview-head">
        <dt>From</dt>
        <dd data-testid="preview-from">{email.from}</dd>
        <dt>Reply-to</dt>
        <dd data-testid="preview-reply-to">{email.replyTo}</dd>
        <dt>To</dt>
        <dd data-testid="preview-to">{people(email.to)}</dd>
        {email.cc.length > 0 && (
          <>
            <dt>Cc</dt>
            <dd data-testid="preview-cc">{people(email.cc)}</dd>
          </>
        )}
        <dt>Subject</dt>
        <dd data-testid="preview-subject">{email.subject}</dd>
      </dl>
      {/* The email's own HTML, in a sandbox without scripts. */}
      <iframe className="ext-preview-body" title="Email preview" sandbox="" srcDoc={email.html} data-testid="preview-body" />
      {failure && <div className="meeting-error-box">Not sent: {failure}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
          Back to editing
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="preview-send"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await meetings.sendMinutes(m.id, input);
              onSent();
            } catch (err) {
              setFailure(err instanceof Error ? err.message : String(err));
              setBusy(false);
            }
          }}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Modal>
  );
}
