/**
 * The time-zone picker's list (CD-488): every IANA zone the browser knows, with today's UTC offset
 * and today's names, the zones a workspace here most likely uses on top, and a search.
 */

/**
 * Zones the browser (ICU) still lists under an old name. The id stays what is saved (the server
 * knows the same list); the label shows the name used today.
 */
const RENAMED: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Godthab': 'America/Nuuk',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Enderbury': 'Pacific/Kanton',
};

/** Shown first: the region the product is for, then the zones customers here deal with most. */
export const COMMON_TIME_ZONES = ['Europe/Belgrade', 'Europe/Sarajevo', 'Europe/Podgorica', 'Europe/Skopje', 'Europe/Zagreb', 'Europe/Ljubljana', 'Europe/Vienna', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'UTC'];

export interface TimeZoneOption {
  /** The IANA id that is saved. */
  id: string;
  /** "Europe/Belgrade" as people read it: "Belgrade", with the region apart. */
  city: string;
  region: string;
  /** Today's offset, e.g. "UTC+1", "UTC+5:30", "UTC". */
  offset: string;
  /** Offset in minutes, for sorting. */
  minutes: number;
}

/** "GMT+5:30" (Intl's shortOffset) → "UTC+5:30" and 330. */
export function parseOffset(gmt: string): { offset: string; minutes: number } {
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(gmt.trim());
  if (!m || !m[1]) return { offset: 'UTC', minutes: 0 };
  const minutes = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  return { offset: `UTC${m[1]}${Number(m[2])}${m[3] ? ':' + m[3] : ''}`, minutes };
}

function offsetOf(id: string, now: Date): { offset: string; minutes: number } {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName');
    return parseOffset(part?.value ?? 'GMT');
  } catch {
    return { offset: 'UTC', minutes: 0 };
  }
}

/** One zone, labelled. */
export function timeZoneOption(id: string, now = new Date()): TimeZoneOption {
  const name = RENAMED[id] ?? id;
  const cut = name.indexOf('/');
  const city = (cut < 0 ? name : name.slice(cut + 1)).replace(/_/g, ' ').replace(/\//g, ' / ');
  const region = cut < 0 ? '' : name.slice(0, cut);
  return { id, city, region, ...offsetOf(id, now) };
}

/** Every zone the browser knows, UTC included, as options sorted by offset then name. */
export function allTimeZones(now = new Date()): TimeZoneOption[] {
  let ids: string[];
  try {
    ids = Intl.supportedValuesOf('timeZone');
  } catch {
    ids = [];
  }
  if (!ids.includes('UTC')) ids = ['UTC', ...ids];
  return ids.map((id) => timeZoneOption(id, now)).sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city));
}

/** This device's zone, when the browser says. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Search text matches the city, region, id (old or new name) or offset, ignoring case and "_". */
export function matchesZone(z: TimeZoneOption, search: string): boolean {
  const q = search.trim().toLowerCase().replace(/_/g, ' ');
  if (!q) return true;
  const hay = [z.city, z.region, z.id.replace(/_/g, ' '), (RENAMED[z.id] ?? '').replace(/_/g, ' '), z.offset].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * What the picker lists: with no search, the suggested zones (this device's, the saved one and the
 * common ones, in that order) and then all; with a search, the matches only, suggested first.
 */
export function zoneSections(all: TimeZoneOption[], search: string, suggestedIds: string[]): { label: string; zones: TimeZoneOption[] }[] {
  const byId = new Map(all.map((z) => [z.id, z]));
  const suggested = [...new Set(suggestedIds)].map((id) => byId.get(id)).filter((z): z is TimeZoneOption => !!z && matchesZone(z, search));
  const picked = new Set(suggested.map((z) => z.id));
  const rest = all.filter((z) => !picked.has(z.id) && matchesZone(z, search));
  return [
    { label: 'Suggested', zones: suggested },
    { label: search.trim() ? 'Other matches' : 'All time zones', zones: rest },
  ].filter((s) => s.zones.length > 0);
}
