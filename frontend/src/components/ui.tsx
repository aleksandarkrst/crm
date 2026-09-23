import { type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------- icons

export function XIcon({ size = 15, stroke = 2 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

export function RemoveButton({ onClick, title = 'Remove', size = 15, stroke, box = 26, style }: { onClick: (e: React.MouseEvent) => void; title?: string; size?: number; stroke?: number; box?: number; style?: CSSProperties }) {
  return (
    <button type="button" className="icon-btn" title={title} onClick={onClick} style={{ width: box, height: box, ...style }}>
      <XIcon size={size} stroke={stroke} />
    </button>
  );
}

/** A destructive action (delete a record). Callers confirm before acting. */
export function DangerButton({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{ cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--danger)', fontSize: 12, padding: '6px 11px', borderRadius: 6, whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- layout primitives

export function Card({ children, style, pad = true }: { children: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return (
    <div className={pad ? 'card card-pad' : 'card'} style={style}>
      {children}
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

export function Avatar({ initials, size = 26, font = 10, square = false, style }: { initials: string; size?: number; font?: number; square?: boolean; style?: CSSProperties }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: font, flex: `0 0 ${size}px`, ...(square ? { borderRadius: 6, background: 'var(--segment)', color: 'var(--text-2)' } : {}), ...style }}
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------- inputs

export function GhostInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ghost ${className}`} {...props} />;
}

export type Opt = string | { value: string; label: string };
const optValue = (o: Opt) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: Opt) => (typeof o === 'string' ? o : o.label);

export function GhostSelect({ options, className = '', chevron = false, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Opt[]; chevron?: boolean }) {
  // An empty or unknown value (e.g. a field never filled in) shows as "—" instead of the first option.
  const current = props.value === undefined ? undefined : String(props.value);
  const unset = current !== undefined && !options.some((o) => optValue(o) === current);
  const select = (
    <select className={`ghost ${className}`} {...props}>
      {unset && (
        <option value={current} disabled>
          {current && current !== '—' ? current : '—'}
        </option>
      )}
      {options.map((o) => (
        <option key={optValue(o)} value={optValue(o)}>
          {optLabel(o)}
        </option>
      ))}
    </select>
  );
  if (!chevron) return select;
  return (
    <div className="select-wrap">
      {select}
      <span className="chev">
        <Chevron />
      </span>
    </div>
  );
}

export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'switch on' : 'switch'} onClick={onClick}>
      <span />
    </button>
  );
}

// ---------------------------------------------------------------- searchable picker

/** Open/close state for a dropdown picker that closes on outside click (and clears its search). */
export function usePicker() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);
  const close = () => {
    setOpen(false);
    setSearch('');
  };
  return { open, setOpen, search, setSearch, ref, close };
}

export function Picker({
  picker,
  children,
  placeholder,
  items,
}: {
  picker: ReturnType<typeof usePicker>;
  children?: ReactNode;
  placeholder?: string;
  items: ReactNode;
}) {
  return (
    <div ref={picker.ref} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
      <div className="picker-trigger">
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {children}
          <input
            className="picker-search"
            value={picker.search}
            placeholder={placeholder}
            onChange={(e) => {
              picker.setSearch(e.target.value);
              picker.setOpen(true);
            }}
            onFocus={() => picker.setOpen(true)}
          />
        </span>
        <button type="button" onClick={() => picker.setOpen(!picker.open)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink)', padding: '2px 0', display: 'flex', alignItems: 'center' }}>
          <Chevron />
        </button>
      </div>
      {picker.open && <div className="picker-pop">{items}</div>}
    </div>
  );
}

export function PersonChip({ initials, label, onDrop }: { initials: string; label: string; onDrop: (e: React.MouseEvent) => void }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Avatar initials={initials} size={20} font={9.5} />
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <RemoveButton onClick={onDrop} box={22} />
    </span>
  );
}

export function PickerRow({ initials, title, subtitle, onPick, square, trailing, style }: { initials: string; title: string; subtitle?: string; onPick: () => void; square?: boolean; trailing?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="picker-item" onClick={onPick} style={style}>
      <Avatar initials={initials} size={22} font={9.5} square={square} />
      {subtitle !== undefined ? (
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>{title}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</span>
        </span>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>{title}</span>
      )}
      {trailing}
    </div>
  );
}

// ---------------------------------------------------------------- filter bar

export interface BarChip {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  /** The first option is a placeholder ("Salesperson") and hidden in the list, unless keepFirst. */
  keepFirst?: boolean;
}

export function FilterBar({
  search,
  chips,
  dirty,
  onClear,
  meta,
  action,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  chips: BarChip[];
  dirty?: boolean;
  onClear?: () => void;
  meta?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      {search && (
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', width: 230 }}>
          <input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            style={{ border: 0, outline: 0, background: 'transparent', fontSize: 13, width: '100%', color: 'var(--ink)' }}
          />
        </div>
      )}
      {chips.map((c, i) => (
        <select
          key={i}
          value={c.value}
          onChange={(e) => c.onChange(e.target.value)}
          style={{ border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--ink)' }}
        >
          {c.options.map((o, oi) => (
            <option key={optValue(o)} value={optValue(o)} hidden={oi === 0 && !c.keepFirst}>
              {optLabel(o)}
            </option>
          ))}
        </select>
      ))}
      {dirty && (
        <button type="button" className="btn btn-secondary" onClick={onClear} style={{ padding: '9px 13px' }}>
          Clear filters
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
        {meta && <span style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{meta}</span>}
        {action && (
          <button type="button" className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modal

export function Modal({ children, maxWidth, z = 45, gap = 16, onBackdrop }: { children: ReactNode; maxWidth: number; z?: number; gap?: number; onBackdrop?: () => void }) {
  return (
    <div className="overlay" style={{ zIndex: z }} onClick={onBackdrop}>
      <div className="modal" style={{ maxWidth, gap }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div className="modal-title">{title}</div>
      <div className="modal-sub">{sub}</div>
    </div>
  );
}

/** Sortable table header cell. */
export function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: 1 | -1; onClick: () => void }) {
  return (
    <button type="button" className="sort-btn" onClick={onClick} style={{ color: active ? 'var(--ink)' : 'var(--text-2)' }}>
      <span>{label}</span>
      <span style={{ fontSize: 10 }}>{active ? (dir === 1 ? '↑' : '↓') : ''}</span>
    </button>
  );
}

export function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<{ key: K; dir: 1 | -1 }>({ key: initial, dir: 1 });
  const toggle = (key: K) => setSort((cur) => ({ key, dir: cur.key === key ? (cur.dir === 1 ? -1 : 1) : 1 }));
  return { sort, toggle };
}
