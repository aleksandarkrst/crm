import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RichText } from '../../components/RichText';
import { RemoveButton } from '../../components/ui';
import type { ApiInternalMinutes, ApiMeeting, ApiMeetingNextStep, InternalMinutesInput } from '../../lib/api';
import { paths } from '../../lib/paths';
import { memberName } from '../../store/selectors';
import { useStore } from '../../store/store';

/** Limits of the minutes (spec 6.1; the API checks them too). */
const SUMMARY_MAX = 10_000;
const AGREEMENTS_MAX = 5_000;
const STEP_MAX = 500;
const STEPS_MAX = 50;
/** Typing is saved after this pause, like the other fields. */
const SAVE_DELAY = 700;

type Part = 'summary' | 'agreements' | 'nextSteps';
interface Draft {
  summary: string;
  agreements: string;
  nextSteps: ApiMeetingNextStep[];
}
const toDraft = (m: ApiInternalMinutes): Draft => ({ summary: m.summary, agreements: m.agreements, nextSteps: m.nextSteps });
const dateText = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The internal minutes of a meeting (CD-132): summary, agreements and next steps, for the team
 * only (never in an email to the customer). Everyone reads them; the organizer, internal
 * participants, admins and owners write them while the meeting is planned or held. Changes save
 * themselves after a pause; a change someone else made to the same part meanwhile is refused with
 * the usual conflict message, and the minutes are read again.
 */
export function InternalMinutes({ meeting }: { meeting: ApiMeeting }) {
  const { s, meetings } = useStore();
  const stored = s.meetingMinutes[meeting.id];
  const [failed, setFailed] = useState(false);
  const actions = useRef(meetings);
  actions.current = meetings;
  const storedVersion = useRef(stored?.updatedAt);
  storedVersion.current = stored?.updatedAt;
  const loaded = !!stored;

  // Read when the tab opens, and again when someone else changed them (the meeting's minutesUpdatedAt moved).
  useEffect(() => {
    if (loaded && storedVersion.current === meeting.minutesUpdatedAt) return;
    let alive = true;
    actions.current.loadMinutes(meeting.id).then(
      () => alive && setFailed(false),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [meeting.id, meeting.minutesUpdatedAt, loaded]);

  if (!stored) {
    return (
      <div className="meeting-muted" data-testid="internal-minutes-loading">
        {failed ? "Couldn't load the minutes. They will load when the connection is back." : 'Loading the minutes…'}
      </div>
    );
  }
  return <MinutesEditor key={meeting.id} m={meeting} stored={stored} />;
}

function MinutesEditor({ m, stored }: { m: ApiMeeting; stored: ApiInternalMinutes }) {
  const { s, meetings } = useStore();
  const allowed = meetings.canEdit(m);
  const editable = allowed && m.status !== 'cancelled';
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const actions = useRef(meetings);
  actions.current = meetings;
  /** The version the draft is based on (If-Match). */
  const base = useRef(stored.updatedAt);
  const dirty = useRef(new Set<Part>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);

  // Someone else's change was read: show it, unless this tab has edits not saved yet.
  useEffect(() => {
    if (dirty.current.size || timer.current || inFlight.current) return;
    setDraft(toDraft(stored));
    base.current = stored.updatedAt;
  }, [stored]);

  /** Taking the server's steps' task links into the draft (the browser never sets them). */
  const withTasks = (d: Draft, from: ApiInternalMinutes): Draft => ({
    ...d,
    nextSteps: d.nextSteps.map((st) => ({ ...st, taskId: from.nextSteps.find((x) => x.id === st.id)?.taskId ?? null })),
  });

  /** Sends the parts changed since the last save, after the saves before it. */
  const flush = (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const parts = [...dirty.current];
    if (!parts.length) return chain.current;
    dirty.current.clear();
    const d = draftRef.current;
    const input: InternalMinutesInput = {};
    if (parts.includes('summary')) input.summary = d.summary;
    if (parts.includes('agreements')) input.agreements = d.agreements;
    if (parts.includes('nextSteps')) input.nextSteps = d.nextSteps.map(({ id, text, ownerUserId, dueDate }) => ({ id, text, ownerUserId, dueDate }));
    inFlight.current++;
    setState('saving');
    chain.current = chain.current.then(async () => {
      const res = await actions.current.saveMinutes(m.id, input, base.current);
      inFlight.current--;
      const more = dirty.current.size > 0 || !!timer.current || inFlight.current > 0;
      if (res && 'saved' in res) {
        base.current = res.saved.updatedAt;
        setDraft((x) => withTasks(x, res.saved));
        if (!more) setState('saved');
      } else if (res && 'conflict' in res) {
        // Their version wins: show it (this tab's edits to that part are dropped, as the message says).
        clearTimeout(timer.current);
        timer.current = undefined;
        dirty.current.clear();
        if (res.conflict) {
          setDraft(toDraft(res.conflict));
          base.current = res.conflict.updatedAt;
        }
        setState('idle');
      } else {
        // Shown by the store; the next change tries these parts again.
        parts.forEach((p) => dirty.current.add(p));
        setState('error');
      }
    });
    return chain.current;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Leaving the page saves what was typed.
  useEffect(() => () => void flushRef.current(), []);

  const change = (part: Part, next: Partial<Draft>) => {
    setDraft((x) => {
      const d = { ...x, ...next };
      draftRef.current = d;
      return d;
    });
    dirty.current.add(part);
    setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY);
  };
  const setStep = (id: string, patch: Partial<ApiMeetingNextStep>) => change('nextSteps', { nextSteps: draftRef.current.nextSteps.map((st) => (st.id === id ? { ...st, ...patch } : st)) });
  const addStep = () => {
    const id = crypto.randomUUID();
    change('nextSteps', { nextSteps: [...draftRef.current.nextSteps, { id, text: '', ownerUserId: null, dueDate: null, taskId: null }] });
    setFocusStep(id);
  };
  const createTask = async (stepId: string) => {
    setBusyStep(stepId);
    await flush();
    const res = await actions.current.createStepTask(m.id, stepId);
    if (res) {
      base.current = res.minutes.updatedAt;
      setDraft((x) => withTasks(x, res.minutes));
    }
    setBusyStep(null);
  };

  const members = s.team.filter((t) => t.status === 'Active');
  const stateText = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : '';

  return (
    <div className="minutes" data-testid="internal-minutes" data-meeting={m.id} data-editable={editable ? 'true' : 'false'}>
      <div className="minutes-head">
        <span className="meeting-muted">For your team only: never sent to the customer.</span>
        <span className={'minutes-state' + (state === 'error' ? ' is-error' : '')} data-testid="minutes-save-state" aria-live="polite">
          {stateText}
        </span>
      </div>
      {m.status === 'cancelled' && <div className="minutes-note">This meeting is cancelled, so its minutes are read-only. Restore it to change them.</div>}
      {!allowed && <div className="minutes-note">Only the organizer, the internal participants, owners and admins can write the minutes.</div>}

      <RichField label="Summary" testId="minutes-summary" value={draft.summary} max={SUMMARY_MAX} editable={editable} placeholder="What was discussed" onChange={(v) => change('summary', { summary: v })} onBlur={() => void flush()} />
      <RichField
        label="Agreements and decisions"
        testId="minutes-agreements"
        value={draft.agreements}
        max={AGREEMENTS_MAX}
        editable={editable}
        placeholder="What was agreed or decided"
        onChange={(v) => change('agreements', { agreements: v })}
        onBlur={() => void flush()}
      />

      <div className="minutes-field">
        <div className="form-label">Next steps</div>
        {draft.nextSteps.length === 0 && !editable && <div className="meeting-muted">No next steps.</div>}
        <div className="minutes-steps" data-testid="minutes-steps">
          {draft.nextSteps.map((st) => {
            const task = st.taskId ? s.leadTasks.find((t) => t.id === st.taskId) : undefined;
            const ownerKnown = !st.ownerUserId || members.some((x) => x.id === st.ownerUserId);
            return (
              <div key={st.id} className="minutes-step" data-testid="minutes-step">
                {editable ? (
                  <>
                    <input
                      className="form-input minutes-step-text"
                      data-testid="step-text"
                      value={st.text}
                      maxLength={STEP_MAX}
                      placeholder="What happens next"
                      aria-label="Next step"
                      autoFocus={focusStep === st.id}
                      onChange={(e) => setStep(st.id, { text: e.target.value })}
                      onBlur={() => void flush()}
                    />
                    <div className="minutes-step-meta">
                      <select className="form-input" data-testid="step-owner" aria-label="Owner" value={st.ownerUserId ?? ''} onChange={(e) => setStep(st.id, { ownerUserId: e.target.value || null })}>
                        <option value="">No owner</option>
                        {!ownerKnown && <option value={st.ownerUserId!}>{memberName(s, st.ownerUserId)}</option>}
                        {members.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      <input className="form-input" type="date" data-testid="step-due" aria-label="Due date" value={st.dueDate ?? ''} onChange={(e) => setStep(st.id, { dueDate: e.target.value || null })} />
                      <StepTask m={m} st={st} task={task} editable busy={busyStep === st.id} onCreate={() => void createTask(st.id)} />
                      <RemoveButton title="Remove the next step" onClick={() => change('nextSteps', { nextSteps: draftRef.current.nextSteps.filter((x) => x.id !== st.id) })} />
                    </div>
                  </>
                ) : (
                  <>
                    <span className="minutes-step-read">{st.text || <span className="meeting-muted">(empty)</span>}</span>
                    <span className="minutes-step-meta meeting-muted">
                      {[st.ownerUserId ? memberName(s, st.ownerUserId) : null, st.dueDate ? 'due ' + dateText(st.dueDate) : null].filter(Boolean).join(' · ')}
                      <StepTask m={m} st={st} task={task} editable={false} busy={false} onCreate={() => undefined} />
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {editable && draft.nextSteps.length < STEPS_MAX && (
          <button type="button" className="btn-plain minutes-add" data-testid="minutes-add-step" onClick={addStep}>
            + Add next step
          </button>
        )}
      </div>

      {stored.updatedByName && stored.updatedAt && <div className="meeting-muted">Last changed by {stored.updatedByName}.</div>}
    </div>
  );
}

/** The task of a next step: a link once created, else "Create task" when the meeting has a deal. */
function StepTask({ m, st, task, editable, busy, onCreate }: { m: ApiMeeting; st: ApiMeetingNextStep; task: { done: boolean } | undefined; editable: boolean; busy: boolean; onCreate: () => void }) {
  if (st.taskId && m.dealId)
    return (
      <Link to={paths.lead(m.dealId)} className="minutes-task-link" data-testid="step-task-link">
        {task?.done ? 'Task done' : 'Task on the deal'} ›
      </Link>
    );
  if (!editable || !m.dealId) return null;
  return (
    <button type="button" className="btn-plain" data-testid="step-create-task" disabled={busy || !st.text.trim()} title={st.text.trim() ? 'Add this step as a task on the deal' : 'Write the step first'} onClick={onCreate}>
      {busy ? 'Creating…' : 'Create task'}
    </button>
  );
}

/**
 * Whether a mouse button or finger is down. A text leaving its editor on blur becomes its (shorter)
 * formatted view; doing that between pointer down and up would move what is being clicked away
 * from under the pointer, so it waits for the pointer to come up.
 */
let pointerDown = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pointerDown = true), true);
  document.addEventListener('pointerup', () => setTimeout(() => (pointerDown = false)), true);
  document.addEventListener('pointercancel', () => (pointerDown = false), true);
}

/** Where the selection is, and the text with a change made around it. */
interface Edit {
  text: string;
  start: number;
  end: number;
}

/** `**bold**` around the selection (or a placeholder to type over). */
function bold(v: string, a: number, b: number): Edit {
  const inner = v.slice(a, b) || 'bold text';
  return { text: v.slice(0, a) + '**' + inner + '**' + v.slice(b), start: a + 2, end: a + 2 + inner.length };
}

/** "- " in front of each selected line, or off again when they all have it. */
function bullets(v: string, a: number, b: number): Edit {
  const from = v.lastIndexOf('\n', a - 1) + 1;
  const nl = v.indexOf('\n', b);
  const to = nl === -1 ? v.length : nl;
  const lines = v.slice(from, to).split('\n');
  const all = lines.every((l) => /^\s*[-*]\s/.test(l));
  const next = lines.map((l) => (all ? l.replace(/^(\s*)[-*]\s/, '$1') : (l.trim() || lines.length === 1) ? '- ' + l : l)).join('\n');
  return { text: v.slice(0, from) + next + v.slice(to), start: from + (lines.length === 1 ? next.length : 0), end: from + next.length };
}

/** `[label](https://…)` from the selection and an address. */
function link(v: string, a: number, b: number, url: string): Edit {
  const label = v.slice(a, b).trim() || url;
  const md = `[${label}](${url})`;
  return { text: v.slice(0, a) + md + v.slice(b), start: a + md.length, end: a + md.length };
}

/**
 * A text with the minutes' formatting (bold, bullet lists, links; see RichText): a textarea with a
 * small toolbar while it is edited, else the formatted text (click to edit).
 */
export function RichField({
  label,
  testId,
  value,
  max,
  editable,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string;
  testId: string;
  value: string;
  max: number;
  editable: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const wantFocus = useRef(false);
  const showEditor = editable && (editing || !value.trim());
  useEffect(() => {
    if (showEditor && wantFocus.current) {
      wantFocus.current = false;
      ref.current?.focus();
    }
  }, [showEditor]);

  const apply = (make: (v: string, a: number, b: number) => Edit | null) => {
    const el = ref.current;
    if (!el) return;
    const r = make(el.value, el.selectionStart, el.selectionEnd);
    if (!r || r.text.length > max) return;
    onChange(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };
  const askLink = (v: string, a: number, b: number) => {
    const raw = window.prompt('Link address', 'https://')?.trim();
    if (!raw || raw === 'https://') return null;
    return link(v, a, b, /^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  };
  // Toolbar buttons keep the focus in the text (mouse down would move it).
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="minutes-field">
      <div className="minutes-field-head">
        <span className="form-label">{label}</span>
        {showEditor && (
          <span className="minutes-toolbar" role="toolbar" aria-label={`Format ${label.toLowerCase()}`}>
            <button type="button" title="Bold" aria-label="Bold" data-testid={testId + '-bold'} onMouseDown={keep} onClick={() => apply(bold)}>
              <b>B</b>
            </button>
            <button type="button" title="Bullet list" aria-label="Bullet list" data-testid={testId + '-bullets'} onMouseDown={keep} onClick={() => apply(bullets)}>
              • List
            </button>
            <button type="button" title="Link" aria-label="Link" data-testid={testId + '-link'} onMouseDown={keep} onClick={() => apply(askLink)}>
              Link
            </button>
          </span>
        )}
      </div>
      {showEditor ? (
        <>
          <textarea
            ref={ref}
            className="form-input minutes-text"
            data-testid={testId}
            rows={value.split('\n').length > 4 ? 8 : 4}
            maxLength={max}
            placeholder={placeholder}
            value={value}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              onBlur();
              const leave = () => document.activeElement !== ref.current && setEditing(false);
              if (pointerDown) window.addEventListener('pointerup', () => setTimeout(leave), { once: true, capture: true });
              else leave();
            }}
            onChange={(e) => onChange(e.target.value)}
          />
          {value.length > max * 0.9 && (
            <span className="meeting-muted">
              {value.length} / {max}
            </span>
          )}
        </>
      ) : value.trim() ? (
        <div
          className={'minutes-preview' + (editable ? ' is-editable' : '')}
          data-testid={testId + '-view'}
          role={editable ? 'button' : undefined}
          tabIndex={editable ? 0 : undefined}
          title={editable ? 'Click to edit' : undefined}
          onClick={(e) => {
            if (!editable || (e.target as HTMLElement).closest('a')) return;
            wantFocus.current = true;
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (editable && e.key === 'Enter') {
              e.preventDefault();
              wantFocus.current = true;
              setEditing(true);
            }
          }}
        >
          <RichText text={value} />
        </div>
      ) : (
        <div className="meeting-muted" data-testid={testId + '-view'}>
          Nothing written yet.
        </div>
      )}
    </div>
  );
}
