import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Picker, PickerRow, usePicker } from '../../components/ui';
import { paths } from '../../lib/paths';
import {
  type ApiCell,
  type ApiLoggable,
  type ApiTimesheetDay,
  type ApiTimesheetRow,
  type ApiTimesheetWeek,
  dayLabel,
  formatHours,
  parseHours,
  shortHours,
  type TimeFormat,
  timesheetApi,
} from '../../lib/timesheetApi';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const EMPTY: ApiCell = { minutes: 0, note: null, entries: 0 };

export type SaveCell = (row: ApiTimesheetRow, date: string, minutes: number, note?: string | null) => Promise<boolean>;

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
  const editable = day.editable && rowAllows && cell.entries <= 1;
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
    setError(!saved);
  };

  const title = cell.entries > 1 ? `${cell.entries} entries on this day: change them on the ${row.kind === 'task' ? 'task' : 'work order'} page` : !editable && row.lockedReason ? row.lockedReason : undefined;
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
      {cell.note && <span className="ts-note-mark" aria-hidden />}
      {editable && cell.entries <= 1 && (
        <button type="button" className="ts-note-btn" aria-label={`Note for ${row.code} ${dayLabel(day.date)}`} tabIndex={-1} data-testid="ts-note-open" onClick={(e) => onNote(e.currentTarget)} />
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

/** "+ Add task or work order": a search over what the person can log on now and isn't in the week yet. */
function AddRow({ week, onAdd }: { week: ApiTimesheetWeek; onAdd: (item: ApiLoggable) => Promise<void> }) {
  const picker = usePicker();
  const [items, setItems] = useState<ApiLoggable[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    timesheetApi.loggable().then(
      (list) => alive && setItems(list),
      (err) => alive && setFailed(projectError(err)),
    );
    return () => {
      alive = false;
    };
  }, [open]);
  const inWeek = new Set(week.rows.map((r) => r.id));
  const q = picker.search.trim().toLowerCase();
  const shown = (items ?? []).filter((i) => !inWeek.has(i.id) && (!q || `${i.code} ${i.name} ${i.path}`.toLowerCase().includes(q)));
  return (
    <div className="ts-row">
      <div style={{ gridColumn: '1 / -1' }}>
        <button
          type="button"
          className="ts-add ts-label"
          data-testid="ts-add-row"
          onClick={() => {
            setOpen((o) => !o);
            picker.setOpen(true);
          }}
        >
          <span className="ts-label-main">+ Add task or work order</span>
          <span className="ts-label-sub">Tasks you are assigned to with time logging on, and open work orders you are on</span>
        </button>
        {open && (
          <div className="ts-add-picker">
            <Picker
              picker={picker}
              placeholder="Search by number, name, company or project"
              items={
                failed ? (
                  <div className="picker-item">{failed}</div>
                ) : items === null ? (
                  <div className="picker-item">Loading</div>
                ) : shown.length === 0 ? (
                  <div className="picker-item" style={{ color: 'var(--text-2)' }}>
                    {items.length ? 'Everything you can log on is in this week' : 'Nothing to log time on yet: you are on no open task or work order'}
                  </div>
                ) : (
                  shown.map((i) => (
                    <PickerRow
                      key={i.id}
                      initials={i.kind === 'task' ? 'T' : 'WO'}
                      square
                      title={`${i.code} ${i.name}`}
                      subtitle={i.path}
                      onPick={() => {
                        picker.close();
                        setOpen(false);
                        void onAdd(i);
                      }}
                    />
                  ))
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The week's grid (design `Timesheet.dc.html#cd-152`): tasks, then work orders, a cell per day
 * (typing replaces, saved when the cell is left, arrows and Tab move, Shift+Enter opens the
 * note), the add row, and Total entered, Expected and Difference.
 */
export function Grid({ week, onSave, onAdd }: { week: ApiTimesheetWeek; onSave: SaveCell; onAdd: (item: ApiLoggable) => Promise<void> }) {
  const format = week.settings.timeFormat;
  const wrap = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<{ key: string; date: string; top: number; left: number } | null>(null);
  const tasks = week.rows.filter((r) => r.kind === 'task');
  const orders = week.rows.filter((r) => r.kind === 'work_order');
  const ordered = [...tasks, ...orders];
  const closeNote = useCallback(() => setNote(null), []);
  const canAdd = week.days.some((d) => d.editable);

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
  const totalMinutes = week.days.reduce((a, d) => a + d.minutes, 0);
  const expected = week.days.reduce((a, d) => a + d.expectedMinutes, 0);
  const noteRow = note && week.rows.find((r) => r.key === note.key);
  const noteDay = note && week.days.find((d) => d.date === note.date);

  const rowEl = (row: ApiTimesheetRow, r: number) => {
    const sub = subLine(row, format);
    return (
      <div className="ts-row" key={row.key} data-testid="ts-row" data-row={row.id}>
        <span className="ts-label">
          <span className="ts-label-main" title={`${row.code} ${row.name}`}>
            <Link to={row.kind === 'task' ? paths.task(row.id) : paths.workOrder(row.id)}>
              {row.code} {row.name}
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

  const sumRow = (label: string, sub: string, value: (d: ApiTimesheetDay) => number, total: number, opts: { strong?: boolean; signed?: boolean; testId: string }) => (
    <div className="ts-row ts-soft" data-testid={opts.testId}>
      <span className="ts-label">
        <span className="ts-label-main" style={{ fontWeight: opts.strong ? 600 : 500, color: opts.strong ? 'var(--ink)' : 'var(--text-2)' }}>
          {label}
        </span>
        <span className="ts-label-sub">{sub}</span>
      </span>
      {week.days.map((d) => {
        const v = value(d);
        const tone = opts.signed && d.date <= today && v !== 0 ? (v < 0 ? ' below' : ' above') : '';
        const empty = !opts.signed && v === 0 && d.expectedMinutes === 0 && !d.holiday;
        return (
          <span key={d.date} className={`ts-sum${opts.strong ? ' strong' : ''}${tone}${isWeekend(d.date) ? ' ts-weekend' : ''}`}>
            {empty || (opts.signed && d.expectedMinutes === 0 && d.minutes === 0) ? '' : shortHours(v, format, opts.signed)}
          </span>
        );
      })}
      <span className="ts-total">{shortHours(total, format, opts.signed)}</span>
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
            const short = d.expectedMinutes > 0 && d.minutes < d.expectedMinutes && d.date <= today;
            return (
              <span key={d.date} className={`ts-day${d.holiday ? ' ts-holiday' : isWeekend(d.date) ? ' ts-weekend' : ''}`} data-testid="ts-day" data-date={d.date} data-status={d.status}>
                <span className="ts-day-name">{DAY_NAMES[i]}</span>
                <span className="ts-day-date">{shortDate(d.date)}</span>
                <span className={`ts-day-total${short ? ' short' : ''}`}>
                  {d.holiday ? `${shortHours(d.minutes, format)} h · holiday` : d.minutes || d.expectedMinutes ? `${shortHours(d.minutes, format)} h` : '—'}
                </span>
              </span>
            );
          })}
          <span className="th" style={{ padding: '10px 8px', textAlign: 'right', alignSelf: 'end', borderLeft: '1px solid var(--divider)' }}>
            Total
          </span>
        </div>
        {tasks.length > 0 && group('Project tasks')}
        {tasks.map((row, i) => rowEl(row, i))}
        {orders.length > 0 && group('Work orders')}
        {orders.map((row, i) => rowEl(row, tasks.length + i))}
        {canAdd && <AddRow week={week} onAdd={onAdd} />}
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
            <span className="ts-total">{shortHours(week.days.reduce((a, d) => a + (d.holiday?.name === name ? d.holiday.minutes : 0), 0), format)}</span>
          </div>
        ))}
        {sumRow('Total entered', 'Tasks and work orders', (d) => d.minutes, totalMinutes, { strong: true, testId: 'ts-total-entered' })}
        {sumRow('Expected', `Standard day ${shortHours(week.settings.dayMinutes, format)} h${holidayNames.length ? ', minus holidays' : ''}`, (d) => d.expectedMinutes, expected, { testId: 'ts-expected' })}
        {sumRow('Difference', 'Entered minus expected', (d) => d.minutes - d.expectedMinutes, totalMinutes - expected, { signed: true, testId: 'ts-difference' })}
      </div>
      {note && noteRow && noteDay && (
        <NotePopover
          key={`${note.key}:${note.date}`}
          row={noteRow}
          day={noteDay}
          cell={noteRow.cells[note.date] ?? EMPTY}
          format={format}
          at={{ top: note.top, left: note.left }}
          onSave={onSave}
          onClose={closeNote}
        />
      )}
    </div>
  );
}
