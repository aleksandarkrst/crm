import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { Popover } from '../../components/Popover';
import { RichText } from '../../components/RichText';
import { CheckIcon, RemoveButton } from '../../components/ui';
import type { ApiInternalMinutes, ApiMeeting, ApiMeetingNextStep, InternalMinutesInput } from '../../lib/api';
import { memberName } from '../../store/selectors';
import { useStore } from '../../store/store';
import { todayIn } from '../../store/time';

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
    // Our own save (already in the draft) is skipped, so a blank step being typed isn't wiped.
    if (dirty.current.size || timer.current || inFlight.current || stored.updatedAt === base.current) return;
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
    // A blank step stays on screen while it's typed but isn't saved (CD-479); one with a task keeps its link.
    if (parts.includes('nextSteps')) input.nextSteps = d.nextSteps.filter((st) => st.text.trim() || st.taskId).map(({ id, text, ownerUserId, dueDate }) => ({ id, text, ownerUserId, dueDate }));
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
    // A due date in the past makes the task overdue at once: ask first (CD-222; the API allows it).
    const due = draftRef.current.nextSteps.find((x) => x.id === stepId)?.dueDate;
    if (due && due < todayIn(s.workspace.timezone) && !(await askConfirm({ title: 'This date is in the past', message: 'The task will be overdue as soon as it is saved.', confirmLabel: 'Save anyway' }))) return;
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
  // While editable, a last column for the save-as-task check (with an opportunity) and the remove button.
  const cols = ['minmax(160px, 2.4fr)', 'minmax(120px, 1.1fr)', '150px', ...(editable ? ['auto'] : [])].join(' ');
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
        {draft.nextSteps.length > 0 && (
          <div className="card minutes-steps" data-testid="minutes-steps">
            <div className="table-head minutes-steps-head" style={{ gridTemplateColumns: cols }}>
              {['Next step', 'Owner', 'Due date', ...(editable ? [''] : [])].map((h, i) => (
                <span key={i} className="th">
                  {h}
                </span>
              ))}
            </div>
            {draft.nextSteps.map((st) => {
              const ownerKnown = !st.ownerUserId || members.some((x) => x.id === st.ownerUserId);
              return (
                <div key={st.id} className="table-row minutes-step" data-testid="minutes-step" style={{ gridTemplateColumns: cols }}>
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
                      <span className="minutes-step-actions">
                        {m.dealId && <StepTask st={st} busy={busyStep === st.id} onSave={() => void createTask(st.id)} />}
                        <RemoveButton title="Remove the next step" onClick={() => change('nextSteps', { nextSteps: draftRef.current.nextSteps.filter((x) => x.id !== st.id) })} />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="minutes-step-read">{st.text || <span className="meeting-muted">(empty)</span>}</span>
                      <span className="minutes-step-cell" data-label="Owner">
                        {st.ownerUserId ? memberName(s, st.ownerUserId) : <span className="meeting-muted">No owner</span>}
                      </span>
                      <span className="minutes-step-cell" data-label="Due date">
                        {st.dueDate ? dateText(st.dueDate) : <span className="meeting-muted">No date</span>}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
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

/**
 * Saving a next step as a task (the meeting has an opportunity): a check next to the remove
 * button puts it on the opportunity, and so on Today, without leaving the meeting. Once saved,
 * the check is gone.
 */
function StepTask({ st, busy, onSave }: { st: ApiMeetingNextStep; busy: boolean; onSave: () => void }) {
  if (st.taskId) return null;
  const text = !!st.text.trim();
  return (
    <button
      type="button"
      className="icon-btn icon-btn-ok"
      data-testid="step-create-task"
      aria-label="Save as a task"
      title={text ? 'Save as a task on the opportunity and on Today' : 'Write the step first'}
      disabled={busy || !text}
      onClick={onSave}
    >
      <CheckIcon />
    </button>
  );
}

/** Where the selection is, and the text with a change made around it. */
interface Edit {
  text: string;
  start: number;
  end: number;
}

/** How many `*` stand right before `a` (2 or 3: bold; 1 or 3: italic). */
const starsBefore = (v: string, a: number) => {
  let n = 0;
  while (n < a && v[a - 1 - n] === '*') n++;
  return n;
};

/**
 * `marker` around the selection (a placeholder to type over without one), or off again when the
 * selection already has it: `**` bold, `*` italic, `__` underline. Spaces at the selection's ends
 * stay outside, since the formatting needs text right inside its markers.
 */
function wrap(marker: string, placeholder: string) {
  return (v: string, a: number, b: number): Edit => {
    while (a < b && /\s/.test(v[a]!)) a++;
    while (b > a && /\s/.test(v[b - 1]!)) b--;
    const n = marker.length;
    const stars = starsBefore(v, a);
    const has =
      v.slice(a - n, a) === marker &&
      v.slice(b, b + n) === marker &&
      (marker === '**' ? stars === 2 || stars === 3 : marker === '*' ? stars === 1 || stars === 3 : true);
    if (has) return { text: v.slice(0, a - n) + v.slice(a, b) + v.slice(b + n), start: a - n, end: b - n };
    const inner = v.slice(a, b) || placeholder;
    return { text: v.slice(0, a) + marker + inner + marker + v.slice(b), start: a + n, end: a + n + inner.length };
  };
}
const bold = wrap('**', 'bold text');
const italic = wrap('*', 'italic text');
const underline = wrap('__', 'underlined text');

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
 * A text with the minutes' formatting (bold, italic, underline, bullet lists, links; see RichText).
 * For someone who may edit it: the toolbar always, and in the same frame the textarea while it has
 * the focus (Ctrl+B, Ctrl+I and Ctrl+U format the selection), else the formatted text, which a
 * click turns back into the textarea (CD-378). Everyone else sees the formatted text.
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
  const [focused, setFocused] = useState(false);
  // The frame keeps its height between the text and the formatted view, so nothing jumps.
  const [height, setHeight] = useState<number | undefined>(undefined);
  const caret = useRef<number | null>(null);
  /** The selection a toolbar button or shortcut made, put back once its text has rendered. */
  const selection = useRef<{ start: number; end: number } | null>(null);
  const writing = editable && (focused || !value.trim());

  // The textarea grows with its text, so the page is the only thing that scrolls and the toolbar
  // (sticky under the screen header) stays usable on long minutes (CD-378 QA, round 2). Measuring
  // needs height auto for a moment, which can make the page shorter: the scroll position stays.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!writing || !el) return;
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    if (window.scrollY !== y) window.scrollTo(window.scrollX, y);
  }, [value, writing]);

  useEffect(() => {
    const el = ref.current;
    if (!focused || !el || caret.current === null) return;
    el.focus();
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [focused]);

  /** From the formatted view to the textarea, the caret at the end. */
  const open = (frame?: HTMLElement) => {
    if (frame) setHeight(frame.offsetHeight);
    caret.current = value.length;
    setFocused(true);
  };
  const apply = (make: (v: string, a: number, b: number) => Edit | null) => {
    const el = ref.current;
    if (!el) return;
    const r = make(el.value, el.selectionStart, el.selectionEnd);
    if (!r || r.text.length > max) return;
    selection.current = { start: r.start, end: r.end };
    onChange(r.text);
    setFocused(true);
  };
  // The new text replaces the textarea's value, which puts the caret at the end; the selection goes
  // back before the browser handles the next key, so Ctrl+B then Ctrl+I format the same text (CD-378 QA).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !selection.current) return;
    el.focus();
    el.setSelectionRange(selection.current.start, selection.current.end);
    selection.current = null;
  }, [value, focused]);
  // The address is asked in a popover by the Link button, not the browser's prompt (CD-490); the selection waits for it.
  const linkBtn = useRef<HTMLButtonElement>(null);
  const [linkAt, setLinkAt] = useState<{ a: number; b: number } | null>(null);
  const askLink = (_v: string, a: number, b: number) => {
    setLinkAt({ a, b });
    return null;
  };
  // Cancelled with Escape (the Popover has put the focus on Link): back to the text with the selection as it was.
  // A click elsewhere leaves the focus where it went.
  const cancelLink = () => {
    const at = linkAt;
    setLinkAt(null);
    if (!at || document.activeElement !== linkBtn.current) return;
    selection.current = { start: at.a, end: at.b };
    setFocused(true);
  };
  const insertLink = (input: string) => {
    const at = linkAt;
    setLinkAt(null);
    const raw = input.trim();
    if (!at || !raw || raw === 'https://') return;
    const r = link(value, at.a, at.b, /^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    if (r.text.length > max) return;
    selection.current = { start: r.start, end: r.end };
    onChange(r.text);
    setFocused(true);
  };
  const keys = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const make = { b: bold, i: italic, u: underline }[e.key.toLowerCase()];
    if (!make) return;
    e.preventDefault();
    apply(make);
  };
  // Toolbar buttons keep the focus in the text (mouse down would move it); on the formatted view
  // they bring the textarea back first, so the format lands at the end of the text.
  const keep = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!writing) open((e.currentTarget as HTMLElement).closest('.minutes-field')?.querySelector<HTMLElement>('.minutes-view') ?? undefined);
  };
  const tools: [string, React.ReactNode, string, (v: string, a: number, b: number) => Edit | null][] = [
    ['Bold (Ctrl+B)', <b key="b">B</b>, 'bold', bold],
    ['Italic (Ctrl+I)', <i key="i">I</i>, 'italic', italic],
    ['Underline (Ctrl+U)', <u key="u">U</u>, 'underline', underline],
    ['Bullet list', '• List', 'bullets', bullets],
    ['Link', 'Link', 'link', askLink],
  ];

  return (
    <div className="minutes-field">
      <div className="minutes-field-head">
        <span className="form-label">{label}</span>
        {editable && (
          <span className="minutes-toolbar" role="toolbar" aria-label={`Format ${label.toLowerCase()}`}>
            {tools.map(([title, face, id, make]) => (
              <button key={id} ref={id === 'link' ? linkBtn : undefined} type="button" title={title} aria-label={title.replace(/ \(.*\)$/, '')} data-testid={`${testId}-${id}`} onMouseDown={keep} onClick={() => apply(make)}>
                {face}
              </button>
            ))}
          </span>
        )}
        {linkAt && (
          <Popover anchor={linkBtn} onClose={cancelLink} className="fr-pop" label="Link address" testId={`${testId}-link-pop`}>
            <form
              style={{ display: 'flex', gap: 8, padding: 4 }}
              onSubmit={(e) => {
                e.preventDefault();
                insertLink(String(new FormData(e.currentTarget).get('url') ?? ''));
              }}
            >
              <input name="url" className="form-input" aria-label="Link address" defaultValue="https://" autoFocus style={{ flex: 1, minWidth: 0 }} />
              <button type="submit" className="btn btn-primary">
                Insert
              </button>
            </form>
          </Popover>
        )}
      </div>
      {writing ? (
        <>
          <textarea
            ref={ref}
            className="form-input minutes-text"
            data-testid={testId}
            rows={value.split('\n').length > 4 ? 8 : 4}
            style={height ? { minHeight: height } : undefined}
            maxLength={max}
            placeholder={placeholder}
            value={value}
            onFocus={() => setFocused(true)}
            onKeyDown={keys}
            onBlur={(e) => {
              setHeight(e.currentTarget.offsetHeight);
              setFocused(false);
              onBlur();
            }}
            onChange={(e) => onChange(e.target.value)}
          />
          {value.length > max * 0.9 && (
            <span className="meeting-muted">
              {value.length} / {max}
            </span>
          )}
        </>
      ) : editable ? (
        <div
          className="form-input minutes-text minutes-view"
          data-testid={testId + '-view'}
          role="textbox"
          aria-label={label}
          tabIndex={0}
          style={height ? { minHeight: height } : undefined}
          // A link in it opens as a link; anywhere else the click (or Tab) starts editing.
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('a')) e.preventDefault();
          }}
          onFocus={(e) => open(e.currentTarget)}
        >
          <RichText text={value} />
        </div>
      ) : value.trim() ? (
        <div className="minutes-preview" data-testid={testId + '-view'}>
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
