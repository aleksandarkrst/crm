/**
 * Dates and times on the clock of a workspace's time zone (IANA name, e.g. "Europe/Belgrade").
 * Instants are stored; people see and type wall-clock times in the workspace zone, across
 * daylight saving changes. An unknown zone falls back to UTC rather than failing.
 */

export interface ZonedParts {
  date: string; // yyyy-mm-dd
  time: string; // HH:mm
  weekday: string; // Mon, Tue, …
  day: number;
  month: string; // Jan, Feb, …
  year: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      });
    } catch {
      return formatter('UTC');
    }
    formatters.set(timeZone, f);
  }
  return f;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An instant's date and time on the zone's clock. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const month = Number(part('month'));
  const hour = String(Number(part('hour')) % 24).padStart(2, '0');
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${hour}:${part('minute')}`,
    weekday: part('weekday'),
    day: Number(part('day')),
    month: MONTHS[month - 1] ?? '',
    year: Number(part('year')),
  };
}

/**
 * When a meeting takes place, for timelines and emails: "Tue 6 Oct 2026, 10:00–11:00", or with
 * both dates when it ends on another day: "Sat 24 Oct 2026, 23:00 – Sun 25 Oct, 01:00".
 */
export function formatTimeRange(start: Date, end: Date, timeZone: string): string {
  const s = zonedParts(start, timeZone);
  const e = zonedParts(end, timeZone);
  const startLabel = `${s.weekday} ${s.day} ${s.month} ${s.year}, ${s.time}`;
  if (s.date === e.date) return `${startLabel}–${e.time}`;
  const endDay = e.year === s.year ? `${e.weekday} ${e.day} ${e.month}` : `${e.weekday} ${e.day} ${e.month} ${e.year}`;
  return `${startLabel} – ${endDay}, ${e.time}`;
}
