import { type ReactNode, useRef, useState } from 'react';
import { addField, canClear, CHECKBOX_OPTIONS, chipLabel, clearAll, DATE_PRESETS, emptyFilter, type FieldFilter, type FilterField, type FilterIcon, type FilterKind, type FilterOp, type FilterOption, type FilterPerson, type FilterValue, isActive, removeField, setField, valueText } from '../store/filters';
import { initialsOf } from '../store/selectors';
import { Popover } from './Popover';

const ICONS: Record<FilterIcon | FilterKind, string> = {
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  date: 'M5 6h14v14H5zM5 10h14M9 3v4M15 3v4',
  number: 'M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16',
  text: 'M5 6h14M12 6v13',
  person: 'M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  status: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2',
  funnel: 'M3 5h18l-7 8v6l-4 2v-8z',
  company: 'M4 20V6l8-3v17M12 9h8v11M7 9h2M7 13h2M15 13h2',
  value: 'M15 7.5a5 5 0 1 0 0 9M6 10.5h7M6 13.5h7',
  checkbox: 'M5 5h14v14H5zM9 12l2 2 4-4',
};
const iconOf = (fd: FilterField<never>) => ICONS[fd.icon ?? fd.kind];
const ADD = '__add';

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/**
 * The filter row every list page uses (CD-366): its pinned chips, the chips added with + Filter,
 * then Clear filters when there is something to clear. A chip opens a popover for its field's type
 * (lists, people, dates, ranges, text, yes / no), so a new custom field needs no code. Changes apply
 * at once; the page keeps the value (see usePageFilters) and filters with store/filters.ts.
 */
export function FilterRow<R>({
  fields,
  value,
  onChange,
  people = [],
  me,
  onClearAll,
  forceClear,
}: {
  fields: FilterField<R>[];
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  people?: FilterPerson[];
  me?: string;
  /** Also clears what the page keeps outside the row (the Calendar's report and deal chips). */
  onClearAll?: () => void;
  /** Something outside the row is set (that onClearAll clears): Clear filters shows for it too. */
  forceClear?: boolean;
}) {
  const [pop, setPop] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const all = fields as FilterField<never>[];
  const order = value.order.filter((id) => all.some((f) => f.id === id));
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? 'Former member';
  const close = () => setPop(null);

  return (
    <div className="fr-row" data-testid="filter-row">
      {order.map((id) => {
        const fd = all.find((f) => f.id === id)!;
        const v = value.f[id];
        return (
          <span key={id} style={{ display: 'contents' }}>
            <Chip fd={fd} v={v} open={pop === id} onToggle={() => setPop(pop === id ? null : id)} onClose={close} text={valueText(fd, v, { me, personName })}>
              <FieldPanel
                fd={fd}
                v={v}
                people={people}
                me={me}
                onPatch={(patch) => onChange(setField(value, id, patch))}
                onClear={() => onChange({ ...value, f: { ...value.f, [id]: emptyFilter(fd) } })}
                onRemove={() => {
                  onChange(removeField(value, id));
                  close();
                }}
              />
            </Chip>
          </span>
        );
      })}
      <button ref={addRef} type="button" className="fr-add" data-testid="filter-add" aria-expanded={pop === ADD} onClick={() => setPop(pop === ADD ? null : ADD)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>Filter</span>
      </button>
      {pop === ADD && (
        <Popover anchor={addRef} onClose={close} label="Add a filter" className="fr-pop fr-pop-add" testId="filter-add-pop" keepOnScroll>
          <AddPanel
            fields={all.filter((fd) => !order.includes(fd.id))}
            groups={[...new Set(all.map((f) => f.group))]}
            onPick={(fd) => {
              onChange(addField(value, fd));
              setPop(fd.id);
            }}
          />
        </Popover>
      )}
      {(forceClear || canClear(fields, value)) && (
        <button
          type="button"
          className="fr-clear"
          data-testid="filter-clear"
          onClick={() => {
            onChange(clearAll(fields, value));
            onClearAll?.();
            close();
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Chip({ fd, v, open, onToggle, onClose, text, children }: { fd: FilterField<never>; v: FieldFilter | undefined; open: boolean; onToggle: () => void; onClose: () => void; text: string; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const on = isActive(fd, v);
  return (
    <>
      <button ref={ref} type="button" className={'fr-chip' + (on ? ' on' : '')} data-testid={'filter-chip-' + fd.id} aria-expanded={open} onClick={onToggle}>
        <Icon d={iconOf(fd)} />
        <span className="fr-chip-label">{chipLabel(fd, v)}</span>
        <span className="fr-chip-val">{text}</span>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <Popover anchor={ref} onClose={onClose} label={fd.label} className="fr-pop" testId={'filter-pop-' + fd.id} keepOnScroll>
          {children}
        </Popover>
      )}
    </>
  );
}

/** + Filter: every field not on the row yet, by group, with a search. */
function AddPanel({ fields, groups, onPick }: { fields: FilterField<never>[]; groups: string[]; onPick: (fd: FilterField<never>) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = groups.map((g) => ({ g, list: fields.filter((fd) => fd.group === g && (!query || fd.label.toLowerCase().includes(query))) })).filter((x) => x.list.length);
  return (
    <>
      <div className="fr-search">
        <input className="fr-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by…" aria-label="Filter by" autoFocus />
      </div>
      <div className="fr-list fr-list-add">
        {shown.map(({ g, list }) => (
          <div key={g} className="stack">
            <span className="fr-group">{g} fields</span>
            {list.map((fd) => (
              <button key={fd.id} type="button" className="fr-opt" data-testid={'filter-field-' + fd.id} onClick={() => onPick(fd)}>
                <span className="fr-opt-icon">
                  <Icon d={iconOf(fd)} size={16} />
                </span>
                <span style={{ flex: 1 }}>{fd.label}</span>
                {fd.custom && <span className="fr-tag">Custom</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      {!shown.length && <span className="fr-none">No more fields to filter by.</span>}
    </>
  );
}

const OPS: Record<'list' | 'text', [FilterOp, string][]> = {
  list: [
    ['is', 'is'],
    ['isnot', 'is not'],
  ],
  text: [
    ['contains', 'contains'],
    ['isempty', 'is empty'],
    ['notempty', 'is not empty'],
  ],
};

interface Row {
  key: string;
  label: string;
  sub?: string;
  on: boolean;
  partial?: boolean;
  radio?: boolean;
  bold?: boolean;
  indent?: boolean;
  option?: FilterOption;
  initials?: string;
  toggle: () => void;
}

/** A chip's popover: what it shows depends on the field's type. */
function FieldPanel({ fd, v, people, me, onPatch, onClear, onRemove }: { fd: FilterField<never>; v: FieldFilter | undefined; people: FilterPerson[]; me?: string; onPatch: (p: FieldFilter) => void; onClear: () => void; onRemove: () => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const vals = v?.vals ?? [];
  const isList = fd.kind === 'list' || fd.kind === 'checkbox';
  const options = fd.kind === 'checkbox' ? CHECKBOX_OPTIONS : (fd.options ?? []);
  const single = fd.single || fd.kind === 'checkbox';
  const ops = fd.kind === 'list' && !fd.single ? OPS.list : fd.kind === 'text' ? OPS.text : null;
  const op = v?.op ?? ops?.[0]![0];
  const toggle = (id: string) => () => onPatch({ vals: single ? [id] : vals.includes(id) ? vals.filter((x) => x !== id) : [...vals, id] });

  let rows: Row[] = [];
  if (isList) {
    const grouped = !!fd.groupLabel && !query;
    const subs = options.filter((o) => o.sub).map((o) => o.id);
    rows = options
      .filter((o) => !query || o.name.toLowerCase().includes(query))
      .map((o) => ({ key: o.id, label: o.name, on: vals.includes(o.id), radio: single, option: o, indent: grouped && o.sub, bold: grouped && !o.sub, toggle: toggle(o.id) }));
    if (grouped && subs.length) {
      const n = subs.filter((x) => vals.includes(x)).length;
      const allOn = n === subs.length;
      rows.unshift({ key: '__group', label: fd.groupLabel!, on: allOn, partial: n > 0, bold: true, toggle: () => onPatch({ vals: allOn ? vals.filter((x) => !subs.includes(x)) : [...new Set([...vals, ...subs])] }) });
    }
  } else if (fd.kind === 'person') {
    rows = [...people]
      .sort((a, b) => Number(b.id === me) - Number(a.id === me))
      .filter((p) => !query || p.name.toLowerCase().includes(query) || (p.id === me && 'me'.includes(query)))
      .map((p) => ({ key: p.id, label: p.id === me ? 'Me' : p.name, sub: p.sub, on: vals.includes(p.id), initials: initialsOf(p.name), toggle: toggle(p.id) }));
  } else if (fd.kind === 'date') {
    rows = DATE_PRESETS.map((p) => ({ key: p.id, label: p.label, on: v?.preset === p.id, radio: true, toggle: () => onPatch({ preset: p.id }) }));
  }
  const hasSearch = fd.kind === 'person' || (fd.kind === 'list' && options.length > 5);
  const money = fd.unit ? ` (${fd.unit})` : '';

  return (
    <>
      {ops && (
        <div className="fr-ops-row">
          <span className="fr-ops-name">{fd.label}</span>
          <div className="fr-ops" role="group" aria-label="Operator">
            {ops.map(([k, label]) => (
              <button key={k} type="button" className={op === k ? 'on' : ''} aria-pressed={op === k} data-testid={'filter-op-' + k} onClick={() => onPatch({ op: k })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {hasSearch && (
        <div className="fr-search">
          <input className="fr-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={fd.kind === 'person' ? 'Search people' : 'Search ' + fd.label.toLowerCase()} aria-label="Search" autoFocus />
        </div>
      )}
      {(rows.length > 0 || isList || fd.kind === 'person') && (
        <div className="fr-list">
          {rows.map((r) => (
            <button key={r.key} type="button" className="fr-opt" data-testid="filter-option" data-value={r.key} aria-pressed={r.on} onClick={r.toggle} style={{ paddingLeft: r.indent ? 30 : 8 }}>
              <span className={'fr-box' + (r.radio ? ' radio' : '') + (r.on || r.partial ? ' on' : '')}>
                {r.on ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  r.partial && <span className="fr-partial" />
                )}
              </span>
              {r.option?.dotClass && <span className={'mt-dot ' + r.option.dotClass} aria-hidden />}
              {r.option?.dot && <span className={'fr-dot' + (r.option.ring ? ' ring' : '')} style={{ background: r.option.dot }} aria-hidden />}
              {r.initials !== undefined && <span className="fr-avatar">{r.initials}</span>}
              <span className="fr-opt-text">
                <span style={{ fontWeight: r.bold ? 600 : 400 }}>{r.label}</span>
                {r.sub && <span className="fr-sub">{r.sub}</span>}
              </span>
            </button>
          ))}
          {!rows.length && <span className="fr-none">No matches.</span>}
        </div>
      )}
      {fd.kind === 'text' && op === 'contains' && (
        <div className="fr-search">
          <input className="fr-input" value={v?.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} placeholder={'Type to filter by ' + fd.label.toLowerCase()} aria-label={fd.label} autoFocus />
        </div>
      )}
      {fd.kind === 'date' && v?.preset === 'custom' && (
        <div className="fr-pair">
          <label>
            From
            <input className="fr-input" type="date" value={v.from ?? ''} onChange={(e) => onPatch({ from: e.target.value })} />
          </label>
          <label>
            To
            <input className="fr-input" type="date" value={v.to ?? ''} onChange={(e) => onPatch({ to: e.target.value })} />
          </label>
        </div>
      )}
      {fd.kind === 'number' && (
        <div className="fr-pair">
          <label>
            At least{money}
            <input className="fr-input" inputMode="numeric" value={v?.min ?? ''} placeholder="0" onChange={(e) => onPatch({ min: e.target.value.replace(/\D/g, '') })} />
          </label>
          <label>
            At most{money}
            <input className="fr-input" inputMode="numeric" value={v?.max ?? ''} placeholder="No limit" onChange={(e) => onPatch({ max: e.target.value.replace(/\D/g, '') })} />
          </label>
        </div>
      )}
      {fd.kind === 'date' && v?.preset && v.preset !== 'custom' && <span className="fr-note">Updates with today's date.</span>}
      {(!fd.required || !fd.pinned) && (
        <div className="fr-foot">
          {!fd.required ? (
            <button type="button" className="fr-foot-btn" data-testid="filter-clear-selection" onClick={onClear}>
              Clear selection
            </button>
          ) : (
            <span />
          )}
          {!fd.pinned && (
            <button type="button" className="fr-foot-btn danger" data-testid="filter-remove" onClick={onRemove}>
              Remove filter
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** What a page shows when its filters leave nothing (CD-366). */
export function FilterEmpty({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <div className="card fr-empty" data-testid="filter-empty">
      <span className="fr-empty-title">No {noun} match these filters</span>
      <span className="fr-empty-text">Change or clear a filter to see more.</span>
      <button type="button" className="btn-plain" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
