import { useState } from 'react';
import { Avatar } from '../../components/ui';
import { type ApiTimeCard, type ApiTimeEntry, dayLabel, entriesApi, type EntryPatch, type NewEntry, parseHours, type RowTarget, shortHours, type TimeFormat } from '../../lib/timesheetApi';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';

/** Hours as the workspace shows them (CD-153): "2.5 h" or "2:30 h". */
const hoursIn = (format: TimeFormat) => (minutes: number) => `${shortHours(minutes, format)} h`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Hours typed in a number field ("2", "2.5"), as whole minutes in steps of 15; null when not a number of hours. */
const minutesOf = (text: string) => {
  const m = parseHours(text);
  return m === null || m === 0 ? null : m;
};

const PENCIL = 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4';
const CROSS = 'M6 6l12 12M18 6L6 18';

function IconButton({ path, label, danger, onClick, testId }: { path: string; label: string; danger?: boolean; onClick: () => void; testId: string }) {
  return (
    <button type="button" className={`time-icon${danger ? ' danger' : ''}`} title={label} aria-label={label} onClick={onClick} data-testid={testId}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={danger ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </button>
  );
}

/** One entry, viewed or edited inline: hours, date and note (Cancel / Save), or Start → End and note (Done) on a work order. */
function EntryRow({ entry, span, format, onSave, onRemove }: { entry: ApiTimeEntry; span: boolean; format: TimeFormat; onSave: (patch: EntryPatch) => Promise<boolean>; onRemove: () => void }) {
  const h = hoursIn(format);
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(entry.date);
  const [from, setFrom] = useState(entry.startTime ?? '');
  const [to, setTo] = useState(entry.endTime ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const { flash } = useStore();
  const withTimes = span && entry.startTime !== null;
  const open = () => {
    setHours(shortHours(entry.minutes, 'decimal'));
    setDate(entry.date);
    setFrom(entry.startTime ?? '');
    setTo(entry.endTime ?? '');
    setNote(entry.note ?? '');
    setEditing(true);
  };
  const save = async () => {
    let patch: EntryPatch;
    if (withTimes) {
      if (!from || !to) return flash('Enter a start and an end');
      patch = { startTime: from, endTime: to, note };
    } else {
      const minutes = minutesOf(hours);
      if (!minutes) return flash('Enter the hours first.');
      patch = { minutes, date, note };
    }
    if (await onSave(patch)) setEditing(false);
  };
  const when = `${dayLabel(entry.date)} · ${entry.name}${entry.startTime ? ` · ${entry.startTime} → ${entry.endTime}` : ''}`;
  const locked = entry.dayStatus === 'submitted' ? 'Submitted' : entry.dayStatus === 'approved' ? 'Approved' : null;
  return (
    <div className="time-entry" data-testid="time-entry" data-entry={entry.id}>
      <Avatar initials={initials(entry.name)} size={22} font={9} />
      {editing ? (
        <div className="time-edit">
          {withTimes ? (
            <>
              <input className="box-input" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Start" data-testid="time-edit-start" style={{ width: 124 }} />
              <span style={{ color: 'var(--text-2)' }}>→</span>
              <input className="box-input" type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} aria-label="End" data-testid="time-edit-end" style={{ width: 124 }} />
            </>
          ) : (
            <>
              <input className="box-input" type="number" min={0.25} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours" data-testid="time-edit-hours" style={{ width: 64, flex: '0 0 64px' }} />
              <input className="box-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" data-testid="time-edit-date" style={{ flex: '0 0 auto', width: 'auto' }} />
            </>
          )}
          <input className="box-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" aria-label="Note" style={{ flex: '1 1 160px', minWidth: 160, width: 'auto' }} />
          {!withTimes && (
            <button type="button" className="btn-plain" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void save()} data-testid="time-edit-save">
            {withTimes ? 'Done' : 'Save'}
          </button>
        </div>
      ) : (
        <>
          <span className="time-entry-text">
            <span className="time-entry-note">{entry.note || (entry.startTime ? `${entry.startTime} → ${entry.endTime}` : '—')}</span>
            <span className="time-entry-when">{when}</span>
          </span>
          <span style={{ fontWeight: 600 }}>{h(entry.minutes)}</span>
          {entry.canChange ? (
            <>
              <IconButton path={PENCIL} label="Edit time entry" onClick={open} testId="time-entry-edit" />
              <IconButton path={CROSS} label="Delete time entry" danger onClick={onRemove} testId="time-entry-delete" />
            </>
          ) : locked ? (
            <span className={`badge ${locked === 'Approved' ? 'badge-brand' : 'badge-neutral'}`} data-testid="time-entry-status">
              {locked}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The task page's Time card and the work order page's Track time card (CD-276; design Projects
 * Prototype `#task`, `#order`): everyone's hours against the estimate or the planned time, the
 * entries the caller may see, Edit and Delete on their own Draft and Rejected days, and the add row.
 * Entries are the timesheet's (one write path, `/api/timesheet/entries`), so they show there too.
 */
export function TimeCard({
  kind,
  target,
  code,
  card,
  error,
  reload,
  today,
  defaultStart,
}: {
  kind: 'task' | 'work_order';
  target: RowTarget;
  /** "T-12" or "WO-1044", for the messages. */
  code: string;
  card: ApiTimeCard | null;
  error: string | null;
  reload: () => Promise<void>;
  today: string;
  /** Where a work order's first entry of the day starts (its scheduled start when it is today). */
  defaultStart?: string | null;
}) {
  const { s, flash } = useStore();
  const format = s.workspace.timesheet.timeFormat;
  const h = hoursIn(format);
  const [hours, setHours] = useState(kind === 'work_order' ? '1' : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const span = kind === 'work_order';

  const run = async (work: () => Promise<unknown>, message: string) => {
    try {
      await work();
      flash(message);
      await reload();
      return true;
    } catch (err) {
      flash(projectError(err));
      return false;
    }
  };

  const add = async () => {
    const minutes = minutesOf(hours);
    if (!minutes) return flash('Enter the hours first.');
    let entry: NewEntry = { date: today, minutes, note: note.trim() || null };
    if (span) {
      // A new entry starts where the last one of today ended, or at the work order's start (design).
      const ends = (card?.entries ?? []).filter((e) => e.mine && e.date === today && e.endTime).map((e) => toMin(e.endTime!));
      const start = ends.length ? Math.max(...ends) : toMin(defaultStart ?? '08:00');
      if (start + minutes >= 24 * 60) return flash('That runs past midnight. Log it as two entries, one on each day.');
      entry = { date: today, startTime: toClock(start), endTime: toClock(start + minutes), note: entry.note };
    }
    setBusy(true);
    if (await run(() => entriesApi.create(target, entry), `${h(minutes)} logged on ${code}.`)) setNote('');
    setBusy(false);
  };

  const planned = kind === 'task' ? (card?.estimateMinutes ?? null) : (card?.plannedMinutes ?? null);
  const logged = card?.loggedMinutes ?? 0;
  const over = planned !== null && logged > planned;
  const pct = planned ? Math.min(100, Math.round((logged / planned) * 100)) : 0;
  const line =
    planned === null
      ? null
      : kind === 'task'
        ? over
          ? `${h(logged - planned)} over the estimate`
          : `${h(planned - logged)} left on the estimate`
        : over
          ? `${h(logged - planned)} over the planned time`
          : `${h(planned - logged)} left of the planned time`;
  const projectClosed = card?.lock?.kind === 'project_closed';
  const showAdd = card && (card.canLog || projectClosed);

  return (
    <div className="card card-pad time-card" data-testid="time-card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span className="caps">{kind === 'task' ? 'Time' : 'Track time'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>From Workforce timesheets</span>
      </div>
      {error && !card ? (
        <span style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</span>
      ) : !card ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading</span>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} data-testid="time-logged">
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: over ? 'var(--danger)' : 'var(--ink)' }}>{h(logged)}</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {planned === null ? 'logged' : kind === 'task' ? `of ${h(planned)} logged` : `of ${h(planned)} planned`}
            </span>
          </div>
          {planned !== null && (
            <>
              <span className="time-bar">
                <span style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--brand)' }} />
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }} data-testid="time-line">
                {line}
              </span>
            </>
          )}
          {card.lock && (
            <div className="hint-box" data-testid="time-lock" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600 }}>{card.lock.title}</span>
              <span>{card.lock.text}</span>
            </div>
          )}
          <div className="time-entries">
            {card.entries.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-2)', padding: '8px 0' }}>{logged > 0 ? 'Only your own entries show here.' : 'No time logged yet.'}</span>}
            {card.entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                span={span}
                format={format}
                onSave={(patch) => run(() => entriesApi.update(e.id, patch), `Time entry updated · ${h(patch.minutes ?? e.minutes)}`)}
                onRemove={() => void run(() => entriesApi.remove(e.id), span ? `Time entry removed from ${code}.` : `${h(e.minutes)} removed from ${code}.`)}
              />
            ))}
          </div>
          {showAdd && (
            <div className="time-add" style={projectClosed ? { opacity: 0.5 } : undefined} data-testid="time-add">
              <input
                className="box-input"
                type="number"
                min={0.25}
                step={0.25}
                value={hours}
                disabled={projectClosed}
                onChange={(e) => setHours(e.target.value)}
                aria-label="Hours"
                data-testid="time-add-hours"
                style={{ width: 64, flex: '0 0 64px' }}
              />
              <input
                className="box-input"
                value={note}
                maxLength={500}
                disabled={projectClosed}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
                placeholder="What did you work on?"
                aria-label="Time note"
                data-testid="time-add-note"
                style={{ flex: '1 1 160px', minWidth: 160, width: 'auto' }}
              />
              <button type="button" className="btn btn-secondary" disabled={projectClosed || busy} style={projectClosed ? { cursor: 'not-allowed' } : undefined} onClick={() => void add()} data-testid="time-add-log">
                Log time
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
