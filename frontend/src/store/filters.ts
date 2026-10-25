// The shared filter row (CD-366): what a field filters on and how a record matches. Pure (no React,
// no store imports), so it is unit-tested with Node's runner (test/filters.test.ts).

/** How a field filters, which also decides its popover: checkboxes, people, dates, a range or a text. */
export type FilterKind = 'list' | 'person' | 'date' | 'number' | 'text' | 'checkbox';
export type FilterIcon = 'list' | 'date' | 'number' | 'text' | 'person' | 'status' | 'funnel' | 'company' | 'value' | 'checkbox';
export type FilterOp = 'is' | 'isnot' | 'contains' | 'isempty' | 'notempty';
export type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'last30' | 'next30' | 'before' | 'custom';

export interface FilterOption {
  id: string;
  name: string;
  /** A colour dot (a CSS colour), or a class that gives the dot its colour (the meeting types). */
  dot?: string;
  dotClass?: string;
  /** Ringed dot (Won's lime on white). */
  ring?: boolean;
  /** Under the field's group row (Status: the open stages under "Open"). */
  sub?: boolean;
}

/** What a record has for a field: one value, several (a meeting's people), or nothing. */
export type FilterRaw = string | number | boolean | null | undefined | readonly string[];

export interface FilterField<R = never> {
  id: string;
  label: string;
  /** "Opportunity", "Company": the + Filter list shows "<group> fields". */
  group: string;
  kind: FilterKind;
  get: (r: R) => FilterRaw;
  options?: FilterOption[];
  /** Always on the row (the page's defaults); the others are added with + Filter. */
  pinned?: boolean;
  /** One value only (radio buttons), no is / is not. */
  single?: boolean;
  /** The row that ticks every `sub` option at once ("Open"). */
  groupLabel?: string;
  /** Money: the currency symbol the range is in. */
  unit?: string;
  custom?: boolean;
  icon?: FilterIcon;
}

/** One field's filter. Lists, people and checkboxes use `vals`; dates `preset` (and from / to); numbers min / max; texts `op` and `text`. */
export interface FieldFilter {
  op?: FilterOp;
  vals?: string[];
  preset?: DatePreset;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  text?: string;
  /** A grouped list (Status): the `sub` options it had seen when saved, so newer ones get ticked. */
  seen?: string[];
}

/** Someone the person filters offer: "Me" first, with "role · team" underneath. */
export interface FilterPerson {
  id: string;
  name: string;
  sub: string;
}

/** A page's filters: the chips in order, and each one's filter. */
export interface FilterValue {
  order: string[];
  f: Record<string, FieldFilter>;
}

/** "Today" (an ISO date, the workspace's) and the month the fiscal year starts (quarters are fiscal). */
export interface FilterContext {
  today: string;
  fiscalMonth?: number;
}

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'next30', label: 'Next 30 days' },
  { id: 'before', label: 'Before today' },
  { id: 'custom', label: 'Custom range' },
];

export const CHECKBOX_OPTIONS: FilterOption[] = [
  { id: 'yes', name: 'Yes' },
  { id: 'no', name: 'No' },
];

export const defaultOp = (fd: FilterField<never>): FilterOp => (fd.kind === 'text' ? 'contains' : 'is');
/** A field's filter with nothing chosen ("Any"). */
export const emptyFilter = (fd: FilterField<never>): FieldFilter => ({ op: defaultOp(fd), vals: [] });

/** Whether the filter narrows anything (otherwise the chip says "Any"). */
export function isActive(fd: FilterField<never>, v: FieldFilter | undefined): boolean {
  if (!v) return false;
  if (fd.kind === 'date') return !!v.preset && (v.preset !== 'custom' || !!(v.from || v.to));
  if (fd.kind === 'number') return !!(v.min || v.max);
  if (fd.kind === 'text') return v.op === 'isempty' || v.op === 'notempty' || !!(v.text || '').trim();
  return (v.vals || []).length > 0;
}

// ---------------------------------------------------------------- dates

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

/**
 * The inclusive ISO dates of a relative preset on `today` (so they move with the date). Weeks run
 * Monday to Sunday; quarters are fiscal ones, counted from `fiscalMonth` (1 = January).
 */
export function presetRange(preset: Exclude<DatePreset, 'custom'>, today: string, fiscalMonth = 1): { from: string; to: string } {
  const [y = 1970, mo = 1, d = 1] = today.split('-').map(Number);
  const m = mo - 1;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const back = (new Date(utc(y, m, d)).getUTCDay() + 6) % 7;
      return { from: iso(utc(y, m, d - back)), to: iso(utc(y, m, d - back + 6)) };
    }
    case 'month':
      return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 0)) };
    case 'quarter': {
      const q = m - (((m - (fiscalMonth - 1)) % 12) + 12) % 3;
      return { from: iso(utc(y, q, 1)), to: iso(utc(y, q + 3, 0)) };
    }
    case 'last30':
      return { from: iso(utc(y, m, d - 30)), to: today };
    case 'next30':
      return { from: today, to: iso(utc(y, m, d + 30)) };
    case 'before':
      return { from: '0000-01-01', to: iso(utc(y, m, d - 1)) };
  }
}

/** The date window of a date filter, inclusive ISO dates (open ends as '' ); null when it isn't active. */
export function dateWindow(v: FieldFilter, ctx: FilterContext): { from: string; to: string } | null {
  if (!v.preset) return null;
  if (v.preset === 'custom') return v.from || v.to ? { from: v.from || '', to: v.to || '' } : null;
  return presetRange(v.preset, ctx.today, ctx.fiscalMonth);
}

// ---------------------------------------------------------------- the whole group ("Open")

/**
 * A grouped list chip ("Open" on Status) saves the whole group as this one value, not the ids it
 * had then: a stage added later, or another funnel's stages, belong to it too.
 */
export const GROUP = '__group';
const subIds = (fd: FilterField<never>) => (fd.options ?? []).filter((o) => o.sub).map((o) => o.id);
/** What a list chip's values stand for now: GROUP is every `sub` option the field has today. */
export function expandVals(fd: FilterField<never>, vals: string[]): string[] {
  return vals.includes(GROUP) ? [...new Set([...subIds(fd), ...vals.filter((x) => x !== GROUP)])] : vals;
}
/** The other way, for saving: every `sub` option ticked is GROUP. */
export function collapseVals(fd: FilterField<never>, vals: string[]): string[] {
  const subs = subIds(fd);
  if (!fd.groupLabel || !subs.length || !subs.every((id) => vals.includes(id))) return vals.filter((x) => x !== GROUP);
  return [GROUP, ...vals.filter((x) => x !== GROUP && !subs.includes(x))];
}
/**
 * A list chip without the values its field no longer offers (another funnel, a stage removed); GROUP
 * stays. `fallback` is used when nothing is left.
 */
export function pruneList<R>(fields: FilterField<R>[], value: FilterValue, id: string, fallback?: string[]): FilterValue {
  const fd = fields.find((f) => f.id === id);
  const v = value.f[id];
  if (!fd || fd.kind !== 'list' || !v?.vals?.length) return value;
  const known = new Set((fd.options ?? []).map((o) => o.id));
  const vals = v.vals.filter((x) => x === GROUP || known.has(x));
  if (vals.length === v.vals.length) return value;
  return setField(value, id, { vals: vals.length || !fallback ? vals : fallback });
}

/**
 * A grouped list chip (Status) with every `sub` option it hasn't seen yet ticked: a stage added to
 * the funnel shows at once (owner's call, 25 Oct). Not for "is not", where it would hide them.
 */
export function withNewSubs<R>(fields: FilterField<R>[], value: FilterValue, id: string): FilterValue {
  const fd = fields.find((f) => f.id === id) as FilterField<never> | undefined;
  const v = value.f[id];
  if (!fd?.groupLabel || !v?.vals?.length || v.op === 'isnot') return value;
  const seen = new Set(v.seen ?? []);
  const fresh = subIds(fd).filter((x) => !seen.has(x) && !expandVals(fd, v.vals!).includes(x));
  return fresh.length ? setField(value, id, { vals: collapseVals(fd, [...expandVals(fd, v.vals), ...fresh]) }) : value;
}
/** Stamps a grouped list chip with the `sub` options it saw, before saving (see withNewSubs). */
export function markSeen<R>(fields: FilterField<R>[], value: FilterValue, id: string): FilterValue {
  const fd = fields.find((f) => f.id === id) as FilterField<never> | undefined;
  return fd?.groupLabel && value.f[id] ? setField(value, id, { seen: subIds(fd) }) : value;
}
/** Another funnel: every Open stage of it, keeping the Won and Lost ticks (owner's call, 25 Oct). */
export function allOpen(value: FilterValue, id: string): FilterValue {
  const v = value.f[id];
  if (!v) return value;
  return setField(value, id, { op: 'is', vals: [GROUP, ...(v.op === 'isnot' ? [] : (v.vals ?? []).filter((x) => x.startsWith('__') && x !== GROUP))], seen: undefined });
}

// ---------------------------------------------------------------- matching

const listOf = (raw: FilterRaw): string[] => (Array.isArray(raw) ? [...raw] : raw === null || raw === undefined || raw === '' ? [] : [String(raw)]);

/** Whether a record's value passes one field's filter (an inactive filter passes everything). */
export function matchField(fd: FilterField<never>, v: FieldFilter | undefined, raw: FilterRaw, ctx: FilterContext): boolean {
  if (!v || !isActive(fd, v)) return true;
  const vals = v.vals || [];
  switch (fd.kind) {
    case 'list': {
      const all = expandVals(fd, vals);
      const hit = listOf(raw).some((x) => all.includes(x));
      return v.op === 'isnot' ? !hit : hit;
    }
    case 'person':
      return listOf(raw).some((x) => vals.includes(x));
    case 'checkbox':
      return vals[0] === 'yes' ? raw === true : raw !== true;
    case 'number': {
      if (raw === null || raw === undefined || raw === '' || Array.isArray(raw)) return false;
      const x = Number(raw);
      if (!Number.isFinite(x)) return false;
      return (!v.min || x >= Number(v.min)) && (!v.max || x <= Number(v.max));
    }
    case 'text': {
      const t = listOf(raw).join(' ').trim().toLowerCase();
      if (v.op === 'isempty') return !t;
      if (v.op === 'notempty') return !!t;
      return t.includes((v.text || '').trim().toLowerCase());
    }
    case 'date': {
      // Records with no date never match a date filter.
      const day = typeof raw === 'string' ? raw.slice(0, 10) : '';
      const w = dateWindow(v, ctx);
      if (!day || !w) return false;
      return (!w.from || day >= w.from) && (!w.to || day <= w.to);
    }
  }
}

/** Every chip of the row, combined with AND. */
export function matches<R>(record: R, fields: FilterField<R>[], value: FilterValue, ctx: FilterContext): boolean {
  return value.order.every((id) => {
    const fd = fields.find((f) => f.id === id);
    return !fd || matchField(fd as FilterField<never>, value.f[id], fd.get(record), ctx);
  });
}

export const applyFilters = <R>(records: R[], fields: FilterField<R>[], value: FilterValue, ctx: FilterContext): R[] => records.filter((r) => matches(r, fields, value, ctx));

// ---------------------------------------------------------------- the chip's text

/** "Status is not", "Website contains": the label follows the operator. */
export function chipLabel(fd: FilterField<never>, v: FieldFilter | undefined): string {
  if (v?.op === 'isnot') return fd.label + ' is not';
  if (fd.kind === 'text' && (v?.op ?? 'contains') === 'contains' && isActive(fd, v)) return fd.label + ' contains';
  return fd.label;
}

const dayLabel = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "€24k", "€1.2m", "€900": short amounts for the chip. */
export const shortAmount = (n: number, unit = '') => {
  const body = n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm' : n >= 1000 ? Math.round(n / 100) / 10 + 'k' : String(n);
  return unit ? (unit.length > 1 ? unit + ' ' : unit) + body : body;
};

/**
 * What the chip says after its label: "Any", up to two values joined with ", ", then "N selected"
 * ("N people"). Status with every open stage ticked says "Open"; the current user is "Me", other
 * people their first name.
 */
export function valueText(fd: FilterField<never>, v: FieldFilter | undefined, ctx: { me?: string; personName?: (id: string) => string } = {}): string {
  if (!v || !isActive(fd, v)) return 'Any';
  const vals = v.vals || [];
  switch (fd.kind) {
    case 'list': {
      const all = expandVals(fd, vals);
      const os = fd.options || [];
      const subs = os.filter((o) => o.sub);
      let rest = os.filter((o) => all.includes(o.id));
      const parts: string[] = [];
      if (fd.groupLabel && subs.length && subs.every((o) => all.includes(o.id))) {
        parts.push(fd.groupLabel);
        rest = rest.filter((o) => !o.sub);
      }
      parts.push(...rest.map((o) => o.name));
      return parts.length > 2 || !parts.length ? all.length + ' selected' : parts.join(', ');
    }
    case 'person':
      if (vals.length > 2) return vals.length + ' people';
      return vals.map((id) => (id === ctx.me ? 'Me' : (ctx.personName?.(id) ?? id).split(' ')[0])).join(', ');
    case 'checkbox':
      return vals[0] === 'yes' ? 'Yes' : 'No';
    case 'date':
      if (v.preset !== 'custom') return DATE_PRESETS.find((p) => p.id === v.preset)?.label ?? 'Any';
      // One-sided ranges read "From 1 Oct" / "Until 1 Oct" (Overview: "closing from 1 Oct").
      if (!v.to) return 'From ' + dayLabel(v.from!);
      if (!v.from) return 'Until ' + dayLabel(v.to);
      return dayLabel(v.from) + ' – ' + dayLabel(v.to);
    case 'number': {
      const a = Number(v.min) || 0;
      const b = Number(v.max) || 0;
      const n = (x: number) => shortAmount(x, fd.unit);
      if (v.min && v.max) return n(a) + '–' + n(b);
      return v.min ? 'at least ' + n(a) : 'at most ' + n(b);
    }
    case 'text':
      return v.op === 'isempty' ? 'Empty' : v.op === 'notempty' ? 'Not empty' : '“' + (v.text || '').trim() + '”';
  }
}

// ---------------------------------------------------------------- changing the row

export const setField = (value: FilterValue, id: string, patch: FieldFilter): FilterValue => ({ ...value, f: { ...value.f, [id]: { ...(value.f[id] || {}), ...patch } } });

/** Adds a field's chip at the end, with nothing chosen yet. */
export const addField = (value: FilterValue, fd: FilterField<never>): FilterValue => ({ order: [...value.order.filter((id) => id !== fd.id), fd.id], f: { ...value.f, [fd.id]: emptyFilter(fd) } });

export function removeField(value: FilterValue, id: string): FilterValue {
  const f = { ...value.f };
  delete f[id];
  return { order: value.order.filter((x) => x !== id), f };
}

/** Clear filters: pinned chips back to "Any", added chips removed. */
export function clearAll<R>(fields: FilterField<R>[]): FilterValue {
  const pinned = fields.filter((fd) => fd.pinned);
  const f: Record<string, FieldFilter> = {};
  for (const fd of pinned) f[fd.id] = emptyFilter(fd as FilterField<never>);
  return { order: pinned.map((fd) => fd.id), f };
}

/** Whether Clear filters would change anything (it shows only then). */
export function canClear<R>(fields: FilterField<R>[], value: FilterValue): boolean {
  return value.order.some((id) => {
    const fd = fields.find((x) => x.id === id);
    return !!fd && (!fd.pinned || isActive(fd as FilterField<never>, value.f[id]));
  });
}

/**
 * A value saved earlier (localStorage, any shape) on top of the page's defaults: the pinned chips
 * first, in the page's order, then the added ones; anything unreadable gives the defaults.
 */
export function restoreValue(saved: unknown, defaults: FilterValue): FilterValue {
  if (!saved || typeof saved !== 'object') return defaults;
  const { order, f } = saved as Partial<FilterValue>;
  if (!Array.isArray(order) || !f || typeof f !== 'object' || Array.isArray(f)) return defaults;
  const added = order.filter((id): id is string => typeof id === 'string' && !defaults.order.includes(id));
  return { order: [...defaults.order, ...new Set(added)], f: { ...defaults.f, ...f } };
}
