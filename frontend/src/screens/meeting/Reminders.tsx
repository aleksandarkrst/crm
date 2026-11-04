import { useRef } from 'react';
import { RemoveButton } from '../../components/ui';
import type { ApiMeeting, ApiReminder, ReminderUnit } from '../../lib/api';
import { useStore } from '../../store/store';
import { useField } from './MeetingFields';

/** As in Google Calendar (CD-376). */
const MAX_REMINDERS = 5;
const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440 };
const MAX_MINUTES = 28 * 1440;
const UNITS: ReminderUnit[] = ['minutes', 'hours', 'days'];
/** What "+ Add reminder" adds: the first of these the person doesn't have yet. */
const NEXT: ApiReminder[] = [
  { amount: 30, unit: 'minutes' },
  { amount: 10, unit: 'minutes' },
  { amount: 1, unit: 'hours' },
  { amount: 1, unit: 'days' },
  { amount: 2, unit: 'hours' },
  { amount: 15, unit: 'minutes' },
  { amount: 2, unit: 'days' },
];
const TYPING_MS = 600;

/** A row as typed: the amount stays text while it is edited. */
interface Row {
  amount: string;
  unit: ReminderUnit;
}
const minutesOf = (r: Row) => Number(r.amount) * UNIT_MINUTES[r.unit];
const unitLabel = (unit: ReminderUnit, amount: string) => (amount.trim() === '1' ? unit.slice(0, -1) : unit);

/** Why these rows can't be saved, or null. */
function rowsError(rows: Row[]): string | null {
  if (rows.some((r) => !/^\d+$/.test(r.amount.trim()))) return 'Give each reminder a whole number.';
  if (rows.some((r) => minutesOf(r) > MAX_MINUTES)) return 'A reminder can be at most 4 weeks before the meeting.';
  const minutes = rows.map(minutesOf);
  return new Set(minutes).size === minutes.length ? null : 'Two of your reminders are at the same time.';
}

/**
 * My reminders (CD-376): the caller's own email reminders of a planned meeting they are on,
 * as in Google Calendar: a number of minutes, hours or days before the start, at most 5. Nobody
 * else's are shown. Each change is saved (a typed number after a pause); a refused one shows the
 * saved list again.
 */
export function MeetingReminders({ m }: { m: ApiMeeting }) {
  const { meetings, flash } = useStore();
  // The saved list comes back earliest first; it is shown in the order the rows are on screen, so
  // a changed amount or unit doesn't move its row.
  const order = useRef<number[]>([]);
  const place = (r: ApiReminder) => {
    const i = order.current.indexOf(r.amount * UNIT_MINUTES[r.unit]);
    return i < 0 ? order.current.length : i;
  };
  const saved = JSON.stringify([...m.myReminders].sort((a, b) => place(a) - place(b)).map((r) => ({ amount: String(r.amount), unit: r.unit })));
  const field = useField(
    saved,
    async (v) => {
      const rows = JSON.parse(v) as Row[];
      const error = rowsError(rows);
      if (error) {
        flash(error);
        return false;
      }
      return meetings.setReminders(
        m.id,
        rows.map((r) => ({ amount: Number(r.amount), unit: r.unit })),
      );
    },
    TYPING_MS,
  );
  const rows = JSON.parse(field.draft) as Row[];
  order.current = rows.map(minutesOf);
  const change = (next: Row[], now: boolean) => {
    field.change(JSON.stringify(next));
    if (now) void field.flush();
  };
  const update = (i: number, row: Partial<Row>, now: boolean) => change(rows.map((r, j) => (j === i ? { ...r, ...row } : r)), now);
  const add = () => {
    const taken = new Set(rows.map(minutesOf));
    const next = NEXT.find((r) => !taken.has(r.amount * UNIT_MINUTES[r.unit])) ?? { amount: 5, unit: 'minutes' };
    change([...rows, { amount: String(next.amount), unit: next.unit }], true);
  };

  return (
    <section className="mf-reminders" aria-label="My reminders" data-testid="meeting-reminders">
      <div className="mf-col-title">
        My reminders <span className="meeting-muted">by email, only you see them</span>
      </div>
      {rows.length === 0 && <div className="reminder-empty">No reminders. You won't get an email before this meeting.</div>}
      {rows.map((r, i) => (
        <div key={i} className="reminder-row" data-testid="meeting-reminder">
          <input
            className="mf-input reminder-amount"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label="How many"
            data-testid="meeting-reminder-amount"
            value={r.amount}
            onChange={(e) => update(i, { amount: e.target.value }, false)}
            onBlur={() => void field.flush()}
          />
          <select className="mf-input reminder-unit" aria-label="Unit" data-testid="meeting-reminder-unit" value={r.unit} onChange={(e) => update(i, { unit: e.target.value as ReminderUnit }, true)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u, r.amount)}
              </option>
            ))}
          </select>
          <RemoveButton box={24} size={13} title="Remove this reminder" onClick={() => change(rows.filter((_, j) => j !== i), true)} />
        </div>
      ))}
      {rows.length < MAX_REMINDERS && (
        <button type="button" className="btn-plain reminder-add" data-testid="meeting-reminder-add" onClick={add}>
          + Add reminder
        </button>
      )}
    </section>
  );
}
