import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays } from '../store/time';

export interface DateRange {
  from: string;
  to: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 1 Jan" (the year is the page's). */
const dayText = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}`;
};

/** "Wed 1 Jan" or "Fri 1 Jan – Sat 2 Jan". */
export const rangeText = (r: DateRange) => (r.from === r.to ? dayText(r.from) : `${dayText(r.from)} – ${dayText(r.to)}`);

/** The weeks of a month ("2026-01"), Monday first, padded with the neighbouring months' days. */
function weeksOf(month: string): string[][] {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days: string[] = [];
  for (let i = -lead; days.length < 42; i++) days.push(addDays(first, i));
  const weeks: string[][] = [];
  for (let i = 0; i < 6; i++) weeks.push(days.slice(i * 7, i * 7 + 7));
  // Drop a trailing week that is entirely next month.
  return weeks.filter((w, i) => i < 4 || w.some((d) => d.startsWith(month)));
}

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * One field for a span of days (CD-318, Holidays): a button that reads the chosen dates and opens
 * a month calendar. The first click picks the first day, the second the last (a single day is
 * both); Escape or a click outside closes it. `month` is the month it opens on without a value.
 * `single` (CD-350, sick leave with no end date yet): one click picks one day.
 */
export function DateRangePicker({ value, onChange, month, placeholder = 'Pick dates', testId, label, single }: { value: DateRange | null; onChange: (r: DateRange) => void; month: string; placeholder?: string; testId?: string; label: string; single?: boolean }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(value?.from.slice(0, 7) ?? month);
  const [start, setStart] = useState<string | null>(null);
  /** Where the calendar opens, on the viewport (CD-354): fixed, so a dialog's scroll area doesn't cut it off. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const field = useRef<HTMLButtonElement>(null);
  /** The calendar, rendered at the top of the page (a dialog's animation would otherwise make it the frame and clip it). */
  const pop = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // A fixed calendar would drift from its field: scrolling anything but the calendar closes it.
    const scroll = (e: Event) => !pop.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    };
  }, [open]);
  const toggle = () => {
    if (!open) {
      setShown(value?.from.slice(0, 7) ?? month);
      setStart(null);
      const r = field.current?.getBoundingClientRect();
      if (r) {
        const height = 340;
        const below = r.bottom + 4 + height <= window.innerHeight;
        setAt({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) });
      }
    }
    setOpen(!open);
  };
  const pick = (day: string) => {
    if (single) {
      onChange({ from: day, to: day });
      setOpen(false);
      return;
    }
    if (!start) return setStart(day);
    onChange(day < start ? { from: day, to: start } : { from: start, to: day });
    setStart(null);
    setOpen(false);
  };
  const [y, m] = shown.split('-').map(Number) as [number, number];
  const inRange = (d: string) => (start ? d === start : !!value && d >= value.from && d <= value.to);
  return (
    <div ref={ref} className="drp" data-testid={testId}>
      <button ref={field} type="button" className={'form-input drp-field' + (value ? '' : ' drp-empty')} aria-label={label} aria-expanded={open} onClick={toggle} data-testid={testId ? `${testId}-open` : undefined}>
        {value ? rangeText(value) : placeholder}
      </button>
      {open &&
        createPortal(
        <div ref={pop} className="drp-pop" role="dialog" aria-label={label} style={at ? { top: at.top, left: at.left } : undefined} data-testid={testId ? `${testId}-calendar` : undefined}>
          <div className="drp-head">
            <button type="button" className="btn-plain drp-nav" aria-label="Previous month" onClick={() => setShown(shiftMonth(shown, -1))}>
              ←
            </button>
            <span className="drp-month">
              {MONTHS[m - 1]} {y}
            </span>
            <button type="button" className="btn-plain drp-nav" aria-label="Next month" onClick={() => setShown(shiftMonth(shown, 1))}>
              →
            </button>
          </div>
          <div className="drp-grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="drp-weekday">
                {w}
              </span>
            ))}
            {weeksOf(shown).flat().map((d) => (
              <button
                key={d}
                type="button"
                className={'drp-day' + (d.startsWith(shown) ? '' : ' other') + (inRange(d) ? ' on' : '') + (value && (d === value.from || d === value.to) ? ' edge' : '')}
                data-date={d}
                aria-pressed={inRange(d)}
                onClick={() => pick(d)}
              >
                {Number(d.slice(8))}
              </button>
            ))}
          </div>
          <span className="drp-hint">{single ? 'Pick the day.' : start ? `From ${dayText(start)}: pick the last day, or the same day again.` : 'Pick the first day, then the last.'}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
