import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import { type ApiCell, type ApiLoggable, type ApiTimesheetDay, type ApiTimesheetRow, type ApiTimesheetWeek, dayLabel, formatHours, parseHours, shortHours, type TimeFormat } from '../../lib/timesheetApi';
import { useStore } from '../../store/store';
import { TaskPicker } from './TaskPicker';

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const EMPTY: ApiCell = { minutes: 0, note: null, entries: 0 };
const DAY_STATUS = { draft: 'Draft', submitted: 'Submitted', rejected: 'Rejected', approved: 'Approved' } as const;

/** true: saved; false: refused (the reason is flashed); null: cancelled at a confirmation. Either way a cell goes back to its saved hours. */
export type SaveCell = (row: ApiTimesheetRow, date: string, minutes: number, note?: string | null) => Promise<boolean | null>;

/** The row's second line (design): its path, then the limit ("4 h left of 6", "1.5 h over your limit of 16") or why it's locked. */
function subLine(row: ApiTimesheetRow, format: TimeFormat): { text: string; over: boolean } {
  const parts = [row.path];
  let over = false;
  if (row.lockedReason) parts.push(row.lockedReason);
  else if (row.kind === 'task' && row.limit) {
    const left = row.limit.limitMinutes - row.limit.loggedMinutes;
    over = left < 0;
    parts.push(over ? `${shortHours(-left, format)} h over your limit of ${shortHours(row.limit.limitMinutes, format)}` : `${shortHours(left, format)} h left of ${shortHours(row.limit.limitMinutes, format)}`);
  } else if (row.kind === 'task') parts.push('no limit');
  return { text: parts.join(' · '), over };
}

/** Whether the person can type in this cell, and how it looks (design: submitted blue, approved green, rejected amber border). */
function cellState(row: ApiTimesheetRow, day: ApiTimesheetDay, cell: ApiCell): { editable: boolean; tone: string } {
  const statusTone = day.status === 'submitted' || day.status === 'approved' ? day.status : '';
  const rowAllows = row.edit === 'any' || (row.edit === 'existing' && cell.minutes > 0);
  // No task hours on a full-day absence (CD-170, spec 14.2); hours already there can still be lowered by clearing them on the task page.
  const editable = day.editable && rowAllows && cell.entries <= 1 && !day.absence;
  if (statusTone) return { editable: false, tone: statusTone };
  if (!editable) return { editable, tone: 'locked' };
  if (cell.minutes > 0 && day.minutes > day.expectedMinutes) return { editable, tone: 'warn' };
  return { editable, tone: day.status === 'rejected' ? 'rejected' : '' };
}

function TimeCell({
  row,
  day,
  cell,
  format,
  r,
  c,
  onSave,
  onNote,
}: {
  row: ApiTimesheetRow;
  day: ApiTimesheetDay;
  cell: ApiCell;
  format: TimeFormat;
  r: number;
  c: number;
  onSave: SaveCell;
  onNote: (el: HTMLElement) => void;
}) {
  const { flash } = useStore();
  const shown = cell.minutes ? shortHours(cell.minutes, format) : '';
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(shown);
      setError(false);
    }
  }, [shown]);
  const { editable, tone } = cellState(row, day, cell);

  const commit = async () => {
    const minutes = parseHours(text);
    if (minutes === null) {
      setError(true);
      flash('Type hours like 7.5, 7,5 or 7:30');
      return;
    }
    if (minutes === cell.minutes) {
      setText(shown);
      setError(false);
      return;
    }
    // Shown rounded at once ("7:20" becomes 7:15); the saved week replaces it.
    setText(minutes ? shortHours(minutes, format) : '');
    const saved = await onSave(row, day.date, minutes);
    // Cancelled or refused (the reason is flashed, CD-336): back to the saved hours, not the refused ones.
    if (!saved) setText(shown);
    setError(false);
  };

  const title = cell.entries > 1 ? `${cell.entries} entries on this day: change them on the ${row.kind === 'task' ? 'task' : row.kind === 'project' ? 'project' : 'work order'} page` : !editable && row.lockedReason ? row.lockedReason : undefined;
  return (
    <span className={`ts-box${isWeekend(day.date) ? ' ts-weekend' : ''}`}>
      <input
        className={`ts-input ${error ? 'error' : tone}`}
        value={text}
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
        inputMode="decimal"
        aria-label={`${row.code} ${dayLabel(day.date)}`}
        title={title}
        data-cell={`${r}:${c}`}
        data-testid="ts-cell"
        data-row={row.id}
        data-date={day.date}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          if (editable) void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey && editable && cell.entries <= 1) {
            e.preventDefault();
            onNote(e.currentTarget);
          } else if (e.key === 'Escape') {
            setText(shown);
            setError(false);
          }
        }}
      />
      {editable && cell.entries <= 1 && (cell.minutes > 0 || cell.note) ? (
        <button
          type="button"
          className={'ts-note-btn ts-dots' + (cell.note ? ' has-note' : '')}
          aria-label={`${cell.note ? 'Note' : 'Add a note'} for ${row.code} ${dayLabel(day.date)}`}
          title={cell.note ? 'More: the note for the approver' : 'More: add a note for the approver'}
          tabIndex={-1}
          data-testid="ts-note-open"
          onClick={(e) => onNote(e.currentTarget)}
        >
          <svg width="4" height="14" viewBox="0 0 4 14" fill="currentColor" aria-hidden>
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="2" cy="7" r="1.5" />
            <circle cx="2" cy="12" r="1.5" />
          </svg>
        </button>
      ) : (
        cell.note && <span className="ts-note-mark" aria-hidden />
      )}
    </span>
  );
}

const isWeekend = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** The note popover (design: 280 px): hours and a note of up to 500 characters, visible to the approver. */
function NotePopover({
  row,
  day,
  cell,
  format,
  at,
  onSave,
  onClose,
}: {
  row: ApiTimesheetRow;
  day: ApiTimesheetDay;
  cell: ApiCell;
  format: TimeFormat;
  at: { top: number; left: number };
  onSave: SaveCell;
  onClose: () => void;
}) {
  const { flash } = useStore();
  const [hours, setHours] = useState(cell.minutes ? formatHours(cell.minutes, format) : '');
  const [note, setNote] = useState(cell.note ?? '');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // A confirmation opened by Save (the over-limit question, CD-336) is not "outside": answering it keeps the note.
      if ((e.target as Element).closest?.('.overlay')) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const save = async () => {
    const minutes = parseHours(hours);
    if (minutes === null) return flash('Type hours like 7.5, 7,5 or 7:30');
    if (minutes === 0 && note.trim()) return flash('Enter the hours first');
    setSaving(true);
    const ok = await onSave(row, day.date, minutes, note);
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <div
      ref={ref}
      className="ts-note-pop"
      style={at}
      role="dialog"
      aria-label={`${row.code} · ${dayLabel(day.date)}`}
      data-testid="ts-note"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
        {row.code} · {dayLabel(day.date)}
      </span>
      <label className="form-label">
        Hours
        <input className="form-input" value={hours} onChange={(e) => setHours(e.target.value)} autoFocus data-testid="ts-note-hours" />
      </label>
      <label className="form-label">
        Note
        <textarea className="box-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="ts-note-text" />
      </label>
      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Up to 500 characters · visible to your approver</span>
      <div className="modal-actions">
        <button type="button" className="btn-plain" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()} data-testid="ts-note-save">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** "+ Task @Project" (CD-354, like Clockify): the dropdown row under the week's rows. */
function AddRow({ week, onAdd, employeeId }: { week: ApiTimesheetWeek; onAdd: (item: ApiLoggable) => Promise<void>; employeeId?: string }) {
  return (
    <div className="ts-row ts-add-row">
      <span className="ts-label">
        <TaskPicker week={week} employeeId={employeeId} onAdd={onAdd} />
      </span>
    </div>
  );
}

/**
 * The week's grid (design `Timesheet.dc.html#cd-152`): tasks, then work orders, a cell per day
 * (typing replaces, saved when the cell is left, arrows and Tab move, Shift+Enter opens the
 * note), the add row, and Total entered, Expected and Difference.
 */
export function Grid({
  week,
  onSave,
  onAdd,
  onRemove,
  onResubmitDay,
  employeeId,
}: {
  week: ApiTimesheetWeek;
  onSave: SaveCell;
  onAdd: (item: ApiLoggable) => Promise<void>;
  /** The row's X (CD-354). */
  onRemove?: (row: ApiTimesheetRow) => Promise<void>;
  /** Day by day mode (CD-158): a rejected day is resubmitted on its own. */
  onResubmitDay?: (date: string) => void;
  /** An Admin entering time for this employee (CD-317): the picker lists what they can log on. */
  employeeId?: string;
}) {
  const format = week.settings.timeFormat;
  const wrap = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<{ key: string; date: string; top: number; left: number } | null>(null);
  // Time on the project itself (CD-350) sits with its tasks, first under the project.
  const tasks = week.rows.filter((r) => r.kind === 'task' || r.kind === 'project');
  const orders = week.rows.filter((r) => r.kind === 'work_order');
  const ordered = [...tasks, ...orders];
  const closeNote = useCallback(() => setNote(null), []);
  // A submitted or approved week takes no new rows (CD-336); a future one has no editable day.
  const canAdd = week.days.some((d) => d.editable) && !['submitted', 'partly_approved', 'approved'].includes(week.status);

  const openNote = (row: ApiTimesheetRow, date: string, el: HTMLElement) => {
    const box = el.closest('.ts-box')!.getBoundingClientRect();
    const outer = wrap.current!.getBoundingClientRect();
    const left = Math.max(0, Math.min(box.left - outer.left, outer.width - 284));
    setNote({ key: row.key, date, top: box.bottom - outer.top + 4, left });
  };

  // Arrows move between cells (spreadsheet style; typing replaces the value).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = (e.target as HTMLElement).dataset.cell;
    if (!at || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const [r, c] = at.split(':').map(Number) as [number, number];
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    for (let nr = r + step[0]!, nc = c + step[1]!; nr >= 0 && nr < ordered.length && nc >= 0 && nc < 7; nr += step[0]!, nc += step[1]!) {
      const next = wrap.current?.querySelector<HTMLInputElement>(`[data-cell="${nr}:${nc}"]`);
      if (next && !next.readOnly) {
        next.focus();
        return;
      }
    }
  };

  const today = week.today;
  const holidayNames = [...new Set(week.days.flatMap((d) => (d.holiday ? [d.holiday.name] : [])))];
  // One read-only row per absence (CD-170): "Vacation", "Sick leave", "Paid leave: Marriage"; pending ones as hints.
  const absenceLabels = [...new Set(week.days.flatMap((d) => (d.absence ? [d.absence.label] : [])))];
  const pendingLabels = [...new Set(week.days.flatMap((d) => (d.pendingAbsence ? [d.pendingAbsence] : [])))];
  const flagged = week.days.filter((d) => d.flags.length);
  const totalMinutes = week.days.reduce((a, d) => a + d.minutes, 0);
  const expected = week.days.reduce((a, d) => a + d.expectedMinutes, 0);
  const noteRow = note && week.rows.find((r) => r.key === note.key);
  const noteDay = note && week.days.find((d) => d.date === note.date);

  /** A row can go while none of its hours are on a submitted or approved day. */
  const removable = (row: ApiTimesheetRow) => week.days.every((d) => !(row.cells[d.date]?.minutes ?? 0) || d.status === 'draft' || d.status === 'rejected');

  const rowEl = (row: ApiTimesheetRow, r: number) => {
    const sub = subLine(row, format);
    return (
      <div className="ts-row" key={row.key} data-testid="ts-row" data-row={row.id}>
        <span className="ts-label">
          <span className="ts-label-main" title={`${row.code} ${row.name}`}>
            <Link to={row.kind === 'task' ? paths.task(row.id) : row.kind === 'project' ? paths.project(row.id) : paths.workOrder(row.id)}>
              {/* The project's own row (CD-350): its name, then "no task". */}
              {row.kind === 'project' ? `${row.path.split(' › ').pop()} · no task` : `${row.code} ${row.name}`}
            </Link>
          </span>
          <span className={`ts-label-sub${sub.over ? ' over' : ''}`} data-testid="ts-row-sub">
            {sub.text}
          </span>
        </span>
        {week.days.map((day, c) => (
          <TimeCell key={day.date} row={row} day={day} cell={row.cells[day.date] ?? EMPTY} format={format} r={r} c={c} onSave={onSave} onNote={(el) => openNote(row, day.date, el)} />
        ))}
        <span className="ts-total" data-testid="ts-row-total">
          {row.minutes ? shortHours(row.minutes, format) : ''}
        </span>
        {/* The row's X (CD-354): gone from the week with its hours, unless some are on a submitted or approved day. */}
        {onRemove && removable(row) ? (
          <button type="button" className="ts-row-x" aria-label={`Remove ${row.kind === 'project' ? `${row.path.split(' › ').pop()} · no task` : `${row.code} ${row.name}`} from this week`} title="Remove this row and its hours from the week" onClick={() => void onRemove(row)} data-testid="ts-row-remove">
            ×
          </button>
        ) : (
          <span className="ts-row-x-empty" />
        )}
      </div>
    );
  };

  const group = (label: string) => (
    <div className="ts-row ts-soft ts-group">
      <span className="ts-label">
        <span className="ts-label-main">{label}</span>
      </span>
    </div>
  );

  /**
   * The one Total row (CD-351, like Clockify's): each day's hours, absences included, and the week's.
   * A day short of its expected hours (on or before today) is marked; the week's expected hours are
   * the row's note, and each day carries its own in a tooltip (`data-expected`).
   */
  const shortOf = (d: ApiTimesheetDay) => d.expectedMinutes > 0 && d.minutes < d.expectedMinutes && d.date <= today;
  const weekShort = week.days.some(shortOf);
  const totalRow = (
    <div className="ts-row ts-soft ts-total-row" data-testid="ts-total-entered">
      <span className="ts-label">
        <span className="ts-label-main" style={{ fontWeight: 600, color: 'var(--ink)' }}>
          Total
        </span>
        <span className="ts-label-sub" data-testid="ts-expected-note">
          Expected {shortHours(expected, format)} h{holidayNames.length ? ', minus holidays' : ''}
        </span>
      </span>
      {week.days.map((d) => (
        <span
          key={d.date}
          className={`ts-sum strong${shortOf(d) ? ' below' : ''}${isWeekend(d.date) ? ' ts-weekend' : ''}`}
          data-expected={shortHours(d.expectedMinutes, format)}
          title={d.expectedMinutes ? `${shortHours(d.minutes, format)} of ${shortHours(d.expectedMinutes, format)} h expected` : undefined}
        >
          {d.minutes === 0 && d.expectedMinutes === 0 ? '' : shortHours(d.minutes, format)}
        </span>
      ))}
      <span className={`ts-total${weekShort ? ' below' : ''}`} title={`${shortHours(totalMinutes, format)} of ${shortHours(expected, format)} h expected`}>
        {shortHours(totalMinutes, format)}
      </span>
    </div>
  );

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <div className="ts-grid" onKeyDown={onKeyDown} data-testid="ts-grid">
        <div className="ts-row ts-head">
          <span className="th" style={{ padding: '10px 14px', alignSelf: 'end' }}>
            Task or work order
          </span>
          {week.days.map((d, i) => {
            return (
              <span key={d.date} className={`ts-day${d.holiday ? ' ts-holiday' : isWeekend(d.date) ? ' ts-weekend' : ''}`} data-testid="ts-day" data-date={d.date} data-status={d.status}>
                <span className="ts-day-name">{DAY_NAMES[i]}</span>
                <span className="ts-day-date">{shortDate(d.date)}</span>
                {/* Totals live in the one Total row (CD-351, as in Clockify); the header only names the day. */}
                {d.holiday && <span className="ts-day-total">Holiday</span>}
                {onResubmitDay && week.resubmittable.includes(d.date) && (
                  <button type="button" className="ts-day-submit" onClick={() => onResubmitDay(d.date)} data-testid="ts-resubmit-day" aria-label={`Resubmit ${dayLabel(d.date)}`}>
                    Resubmit
                  </button>
                )}
                {d.status !== 'draft' && <span className={`ts-day-status ${d.status}`}>{DAY_STATUS[d.status]}</span>}
              </span>
            );
          })}
          <span className="th" style={{ padding: '10px 8px', textAlign: 'right', alignSelf: 'end', borderLeft: '1px solid var(--divider)' }}>
            Total
          </span>
        </div>
        {tasks.length > 0 && group('Projects')}
        {tasks.map((row, i) => rowEl(row, i))}
        {orders.length > 0 && group('Work orders')}
        {orders.map((row, i) => rowEl(row, tasks.length + i))}
        {canAdd && <AddRow week={week} onAdd={onAdd} employeeId={employeeId} />}
        {holidayNames.map((name) => (
          <div className="ts-row ts-soft" key={name} data-testid="ts-holiday-row">
            <span className="ts-label">
              <span className="ts-label-main" style={{ color: 'var(--text-2)' }}>
                Public holiday · {name}
              </span>
              <span className="ts-label-sub">From the holiday calendar</span>
            </span>
            {week.days.map((d) => (
              <span key={d.date} className={`ts-box${isWeekend(d.date) ? ' ts-weekend' : ''}`}>
                <span className="ts-auto">{d.holiday?.name === name ? shortHours(d.holiday.minutes, format) : ''}</span>
              </span>
            ))}
            <span className="ts-total">
              {shortHours(
                week.days.reduce((a, d) => a + (d.holiday?.name === name ? d.holiday.minutes : 0), 0),
                format,
              )}
            </span>
          </div>
        ))}
        {absenceLabels.map((label) => (
          <div className="ts-row ts-soft" key={label} data-testid="ts-absence-row">
            <span className="ts-label">
              <span className="ts-label-main" style={{ color: 'var(--text-2)' }} title={label}>
                {label}
              </span>
              <span className="ts-label-sub">From Time off</span>
            </span>
            {week.days.map((d) => (
              <span key={d.date} className={`ts-box${isWeekend(d.date) ? ' ts-weekend' : ''}`}>
                <span className="ts-auto">{d.absence?.label === label ? shortHours(d.absence.minutes, format) : ''}</span>
              </span>
            ))}
            <span className="ts-total">
              {shortHours(
                week.days.reduce((a, d) => a + (d.absence?.label === label ? d.absence.minutes : 0), 0),
                format,
              )}
            </span>
          </div>
        ))}
        {pendingLabels.map((label) => (
          <div className="ts-row ts-soft" key={label} data-testid="ts-pending-row">
            <span className="ts-label">
              <span className="ts-label-main" style={{ color: 'var(--muted)' }} title={label}>
                {label}
              </span>
              <span className="ts-label-sub">No hours until it is approved</span>
            </span>
            {week.days.map((d) => (
              <span key={d.date} className={`ts-box${isWeekend(d.date) ? ' ts-weekend' : ''}`}>
                <span className="ts-auto" style={{ color: 'var(--muted)' }}>{d.pendingAbsence === label ? 'pending' : ''}</span>
              </span>
            ))}
            <span className="ts-total" />
          </div>
        ))}
        {totalRow}
      </div>
      {flagged.length > 0 && (
        <div className="ts-flags" data-testid="ts-absence-flags">
          {flagged.map((d) => (
            <span key={d.date} className="emp-note emp-warn">
              {dayLabel(d.date)}: {d.flags.join(' · ')}
            </span>
          ))}
        </div>
      )}
      {note && noteRow && noteDay && (
        <NotePopover key={`${note.key}:${note.date}`} row={noteRow} day={noteDay} cell={noteRow.cells[note.date] ?? EMPTY} format={format} at={{ top: note.top, left: note.left }} onSave={onSave} onClose={closeNote} />
      )}
    </div>
  );
}
