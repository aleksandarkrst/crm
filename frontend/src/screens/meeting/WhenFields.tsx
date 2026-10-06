import { useEffect, useRef, useState } from 'react';
import { DAY_SLOTS, isWholeDate, isWholeTime, parseDate, parseTime } from '../../store/meetingTime';
import { useStore } from '../../store/store';
import { addDays, addMonths, dateLabel, monthLabel, monthStart, todayIn, weekStart } from '../../store/time';

/** Closes a dropdown on a press outside `ref`. */
function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [ref, open, close]);
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * A date in the app's own style ("Tue 6 Oct 2026", CD-221) instead of the browser's date input:
 * typed ("6.10.2026", "6 Oct", "2026-10-06") or picked on a small month. `data-value` holds the
 * ISO date for tests and scripts.
 */
export function DateField({ value, onChange, label, testId, disabled }: { value: string; onChange: (iso: string) => void; label: string; testId?: string; disabled?: boolean }) {
  const { s } = useStore();
  const today = todayIn(s.workspace.timezone);
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(value || today));
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(() => setOpen(false)).current;
  useOutside(ref, open, close);
  const shown = text ?? (value ? dateLabel(value, { year: true }) : '');
  const commit = (iso: string | null) => iso && iso !== value && onChange(iso);
  const finish = () => {
    if (text !== null) commit(parseDate(text, today));
    setText(null);
  };
  const first = weekStart(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  return (
    <div ref={ref} className="dt-field dt-date">
      <input
        className="dt-input"
        aria-label={label}
        data-testid={testId}
        data-value={value}
        value={shown}
        disabled={disabled}
        onFocus={(e) => {
          setText(shown);
          setMonth(monthStart(value || today));
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (isWholeDate(e.target.value)) commit(e.target.value.trim());
        }}
        onBlur={(e) => {
          finish();
          if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish();
            setOpen(false);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setText(null);
            setOpen(false);
          }
        }}
      />
      {open && !disabled && (
        <div className="dt-pop dt-month" role="dialog" aria-label={`${label}: pick a day`}>
          <div className="dt-month-head">
            <button type="button" className="dt-nav" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              ‹
            </button>
            <span>{monthLabel(month)}</span>
            <button type="button" className="dt-nav" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              ›
            </button>
          </div>
          <div className="dt-month-grid">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="dt-weekday" aria-hidden>
                {w}
              </span>
            ))}
            {days.map((d) => (
              <button
                key={d}
                type="button"
                className={'dt-day' + (d.slice(0, 7) !== month.slice(0, 7) ? ' is-other' : '') + (d === value ? ' is-on' : '') + (d === today ? ' is-today' : '')}
                aria-label={dateLabel(d, { year: true, weekday: 'long' })}
                aria-pressed={d === value}
                data-day={d}
                onClick={() => {
                  setText(null);
                  setOpen(false);
                  commit(d);
                }}
              >
                {Number(d.slice(8))}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One time in a TimeField's list: "10:30", with a hint such as the length ("1 h"). */
export interface TimeOption {
  time: string;
  hint?: string;
}
const DAY_OPTIONS: TimeOption[] = DAY_SLOTS.map((time) => ({ time }));

/**
 * A 24-hour time (CD-221), never the browser's 12-hour time input: a list in quarter hours
 * (`options`, e.g. end times with the length) or typed ("930", "9:30", "21.15"). `onChange` gets
 * the time and, when it was picked from the list, the option's index.
 */
export function TimeField({
  value,
  onChange,
  options = DAY_OPTIONS,
  label,
  testId,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (time: string, picked?: number) => void;
  options?: TimeOption[];
  label: string;
  testId?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(() => setOpen(false)).current;
  useOutside(ref, open, close);
  const shown = text ?? value;
  const commit = (t: string | null) => t && t !== value && onChange(t);
  const finish = () => {
    if (text !== null) commit(parseTime(text));
    setText(null);
  };
  // The list opens at the current time (or the first one after it).
  const at = Math.max(0, options.findIndex((o) => o.time >= value));
  useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current.children[at] as HTMLElement | undefined;
    if (el) list.current.scrollTop = el.offsetTop - list.current.clientHeight / 2 + el.offsetHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it opens
  }, [open]);
  return (
    <div ref={ref} className="dt-field dt-time">
      <input
        className={'dt-input' + (invalid ? ' is-invalid' : '')}
        aria-label={label}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        inputMode="numeric"
        value={shown}
        disabled={disabled}
        onFocus={(e) => {
          setText(shown);
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (isWholeTime(e.target.value)) commit(parseTime(e.target.value));
        }}
        onBlur={(e) => {
          finish();
          if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish();
            setOpen(false);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setText(null);
            setOpen(false);
          }
        }}
      />
      {open && !disabled && (
        <div ref={list} className="dt-pop dt-times" role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={o.time === value}
              className={'dt-time-option' + (o.time === value ? ' is-on' : '')}
              data-time={o.time}
              onClick={() => {
                setText(null);
                setOpen(false);
                onChange(o.time, i);
              }}
            >
              {o.time}
              {o.hint && <span className="dt-hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
