/**
 * Overview (CD-531, boards C-Overview and C-Overview-Stage): what its cards hand the Pipeline and
 * how its funnel bands are shaded. Pure (no React, no store), so it is unit-tested with Node's
 * runner (test/overview.test.ts).
 */
import { type FieldFilter, type FilterValue, GROUP } from './filters.ts';

/** Overview keeps its Pipeline choice with the other filters under this key (not a chip). */
export const PIPELINE_KEY = 'audience';
/** The Status filter's value for the won outcome (filterFields.ts WON). */
const WON = '__won';

/** What a KPI card opens on the Pipeline: the open opportunities, the won ones, or the stalled ones. */
export type PipelineTarget = { kind: 'open' } | { kind: 'won' } | { kind: 'stalled' };

/** A Stalled opportunity has had no contact for this many days or more. */
export const STALL_DAYS = 3;

/**
 * The Pipeline's filters for a card on Overview: Overview's own (Salesperson, Closing date and any
 * added with + Filter), with Status set to what the card counts. Stalled adds "Days since contact:
 * at least 3" (the spec's "No contact 3+ days"). Overview's Pipeline choice isn't a filter there:
 * the Pipeline shows one funnel, picked with its own select.
 */
export function pipelineFilters(overview: FilterValue, target: PipelineTarget): FilterValue {
  const status: FieldFilter = { op: 'is', vals: [target.kind === 'won' ? WON : GROUP] };
  const rest = overview.order.filter((id) => id !== 'owner' && id !== 'status' && id !== PIPELINE_KEY && id !== 'stall');
  const f: Record<string, FieldFilter> = { owner: overview.f.owner ?? { op: 'is', vals: [] }, status };
  for (const id of rest) if (overview.f[id]) f[id] = overview.f[id]!;
  const order = ['owner', 'status', ...rest];
  if (target.kind === 'stalled') {
    f.stall = { min: String(STALL_DAYS) };
    order.push('stall');
  }
  return { order, f };
}

/**
 * A funnel band's shade, 0 (light green) to 7 (green 700), spread over the funnel's stages; the
 * won stage is lime. `dark`: the band needs white text. The lime takes dark green text: white on
 * it (as the board drew it) is under 3:1.
 */
export function bandShade(i: number, n: number, won: boolean): { shade: number | 'won'; dark: boolean } {
  if (won) return { shade: 'won', dark: false };
  const shade = n > 1 ? Math.round((i * 7) / (n - 1)) : 0;
  return { shade, dark: shade >= 3 };
}

/** A band's width: the first stage full, narrowing by `drop` percentage points to the last. */
export const bandWidth = (i: number, n: number, drop = 58): string => Math.round(100 - (i * drop) / Math.max(1, n - 1)) + '%';

/** Whole days since `since` (an ISO date-time), 0 when unknown or in the future. */
export function daysSince(since: string | undefined, now = Date.now()): number {
  const at = since ? Date.parse(since) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86_400_000)) : 0;
}

/** "1 day", "3 days". */
export const dayCount = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
