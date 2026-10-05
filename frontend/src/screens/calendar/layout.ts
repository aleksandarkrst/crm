/**
 * Where meetings go on the Calendar (CD-130): pure functions, memoized by the views so a month
 * with 500 meetings is laid out once per change, not on every render.
 */
import type { ApiMeeting } from '../../lib/api';
import { addDays, instantToZoned, zonedToInstant } from '../../store/time';

/** One meeting's part of one day in the time grid; minutes are wall-clock minutes of that day. */
export interface Segment {
  m: ApiMeeting;
  top: number;
  bottom: number;
  /** Side by side with overlapping meetings: column `col` of `cols`. */
  col: number;
  cols: number;
  /** It began the day before / goes on the next day (crosses midnight). */
  fromBefore: boolean;
  toAfter: boolean;
}

/** The shortest a block is drawn (minutes), so a 5-minute call stays readable and clickable. */
export const MIN_BLOCK = 30;

/** Each day's segments, side by side where they overlap. */
export function layoutDays(days: string[], meetings: ApiMeeting[], tz: string): Segment[][] {
  const bounds = days.map((d) => [zonedToInstant(d, 0, tz), zonedToInstant(addDays(d, 1), 0, tz)] as const);
  const out: Segment[][] = days.map(() => []);
  for (const m of meetings) {
    const start = Date.parse(m.startsAt);
    const end = Math.max(Date.parse(m.endsAt), start + 60_000);
    for (let i = 0; i < days.length; i++) {
      const [dayStart, dayEnd] = bounds[i]!;
      if (start >= dayEnd || end <= dayStart) continue;
      const fromBefore = start < dayStart;
      const toAfter = end > dayEnd;
      const top = fromBefore ? 0 : instantToZoned(start, tz).minutes;
      const bottom = end >= dayEnd ? 1440 : instantToZoned(end, tz).minutes || 1440;
      out[i]!.push({ m, top, bottom: Math.max(bottom, top + 1), col: 0, cols: 1, fromBefore, toAfter });
    }
  }
  for (const segs of out) placeSideBySide(segs);
  return out;
}

/** Overlapping segments share the width: each gets the first free column of its cluster. */
function placeSideBySide(segs: Segment[]) {
  segs.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster: Segment[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const s of cluster) s.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const s of segs) {
    const shownBottom = Math.max(s.bottom, s.top + MIN_BLOCK);
    if (s.top >= clusterEnd) close();
    let col = colEnds.findIndex((e) => e <= s.top);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(shownBottom);
    } else colEnds[col] = shownBottom;
    s.col = col;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, shownBottom);
  }
  close();
}

/** The meetings of each date (a meeting across midnight is on every day it touches), by start. */
export function bucketByDay(days: string[], meetings: ApiMeeting[], tz: string): Map<string, ApiMeeting[]> {
  const out = new Map<string, ApiMeeting[]>(days.map((d) => [d, []]));
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return out;
  for (const m of meetings) {
    const a = instantToZoned(m.startsAt, tz).date;
    // The last day it touches: the end minus a moment (a meeting ending at midnight isn't on the next day).
    const b = instantToZoned(Math.max(Date.parse(m.startsAt), Date.parse(m.endsAt) - 1), tz).date;
    for (let d = a < first ? first : a; d <= b && d <= last; d = addDays(d, 1)) out.get(d)?.push(m);
  }
  for (const list of out.values()) list.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
  return out;
}
