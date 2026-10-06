import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ApiEmployee } from '../../lib/api';
import { Avatar, Chevron } from '../../components/ui';
import { foldName, initialsOfEmployee } from '../../store/people';

/** True on phones (≤700px, as the CSS): the chart becomes an indented list, list rows become cards. */
export function usePhone(): boolean {
  const query = '(max-width: 700px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** Warning icons for Administration and Admin (spec 5.3): no manager, start date missing. */
export function IssueIcons({ e }: { e: ApiEmployee }) {
  const issues = e.hr?.dataIssues ?? [];
  const shown = [issues.includes('no_manager') && 'No manager', issues.includes('no_start_date') && 'Start date missing'].filter(Boolean) as string[];
  if (!shown.length) return null;
  return (
    <span className="org-issues" data-testid="org-issue" title={shown.join(' · ')} aria-label={shown.join(', ')}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17.5h.01" />
      </svg>
      {shown.length > 1 && <span>{shown.length}</span>}
    </span>
  );
}

/**
 * One person on the chart: initials, name, job title (and team, on the reporting tree), warnings for
 * HR. A button: clicking opens the card. Draggable when the caller may move people (spec 6.3).
 */
export function PersonBox({
  e,
  onOpen,
  badge,
  sub,
  hr,
  dim,
  hit,
  draggable,
  extra,
}: {
  e: ApiEmployee;
  onOpen: (id: string) => void;
  badge?: string;
  sub?: string | null;
  hr: boolean;
  dim?: boolean;
  hit?: boolean;
  draggable?: boolean;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={'org-person' + (dim ? ' is-dim' : '') + (hit ? ' is-hit' : '')}
      data-testid="org-person"
      data-id={e.id}
      draggable={draggable}
      onDragStart={draggable ? (ev) => ev.dataTransfer.setData('text/x-employee', e.id) : undefined}
      onClick={() => onOpen(e.id)}
      title={e.fullName}
    >
      <Avatar initials={initialsOfEmployee(e)} size={26} font={10} />
      <span className="org-person-text">
        <span className="org-person-name">
          {e.fullName}
          {badge && <span className="org-badge">{badge}</span>}
        </span>
        {(e.jobTitle || sub) && <span className="org-person-sub">{[e.jobTitle, sub].filter(Boolean).join(' · ')}</span>}
      </span>
      {hr && <IssueIcons e={e} />}
      {extra}
    </button>
  );
}

/** A dropdown of checkboxes ("Department: Sales +1"), for the filters that take several values. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  testId,
  empty,
  emptyAction,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  testId: string;
  empty?: string;
  /** Shown under `empty` when there are no options at all, e.g. "Add department" (CD-224). */
  emptyAction?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);
  const chosen = options.filter((o) => value.includes(o.value));
  const shown = search.trim() ? options.filter((o) => foldName(o.label).includes(foldName(search.trim()))) : options;
  const text = chosen.length === 0 ? label : `${label}: ${chosen[0]!.label}${chosen.length > 1 ? ` +${chosen.length - 1}` : ''}`;
  return (
    <div className="org-multi" ref={ref}>
      <button type="button" className={'cal-select org-multi-btn' + (chosen.length ? ' on' : '')} data-testid={testId} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="org-multi-label">{text}</span>
        <Chevron />
      </button>
      {open && (
        <div className="org-multi-pop" role="listbox" aria-multiselectable>
          {options.length > 8 && <input className="form-input org-multi-search" placeholder="Search…" value={search} onChange={(ev) => setSearch(ev.target.value)} autoFocus />}
          {shown.length === 0 && <div className="org-multi-empty">{options.length ? 'Nothing matches' : (empty ?? 'Nothing to pick')}</div>}
          {options.length === 0 && emptyAction?.(() => setOpen(false))}
          {shown.map((o) => (
            <label key={o.value} className="org-multi-item">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])} />
              <span>{o.label}</span>
            </label>
          ))}
          {chosen.length > 0 && (
            <button type="button" className="org-multi-clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Picks one employee by typing (name, job title, email): the Manager filter and "Set manager".
 * Shows the first 50 matches; `none` adds a choice for "nobody".
 */
export function EmployeePicker({ employees, value, onChange, placeholder, testId, none, autoFocus, inline }: { employees: readonly ApiEmployee[]; value: string | null; onChange: (id: string | null) => void; placeholder: string; testId: string; none?: string; autoFocus?: boolean; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);
  const current = value ? employees.find((e) => e.id === value) : null;
  const q = foldName(search.trim());
  const matches = (q ? employees.filter((e) => foldName(`${e.fullName} ${e.jobTitle ?? ''} ${e.workEmail ?? ''}`).includes(q)) : employees).slice(0, 50);
  return (
    <div className={inline ? 'org-picker is-inline' : 'org-picker'} ref={ref}>
      <input
        className="form-input"
        data-testid={testId}
        placeholder={current ? current.fullName : placeholder}
        value={open ? search : (current?.fullName ?? '')}
        autoFocus={autoFocus}
        onFocus={() => {
          setSearch('');
          setOpen(true);
        }}
        onChange={(ev) => {
          setSearch(ev.target.value);
          setOpen(true);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') setOpen(false);
          if (ev.key === 'Enter' && matches[0]) {
            ev.preventDefault();
            onChange(matches[0].id);
            setOpen(false);
          }
        }}
        aria-label={placeholder}
      />
      {open && (
        <div className="org-multi-pop org-picker-pop" role="listbox">
          {none && (
            <button type="button" className="org-picker-item" onClick={() => (onChange(null), setOpen(false))}>
              <span className="org-person-sub">{none}</span>
            </button>
          )}
          {matches.length === 0 && <div className="org-multi-empty">Nobody matches</div>}
          {matches.map((e) => (
            <button key={e.id} type="button" role="option" aria-selected={e.id === value} className="org-picker-item" data-testid="org-picker-item" onClick={() => (onChange(e.id), setOpen(false))}>
              <Avatar initials={initialsOfEmployee(e)} size={22} font={9.5} />
              <span className="org-person-text">
                <span className="org-person-name">{e.fullName}</span>
                {e.jobTitle && <span className="org-person-sub">{e.jobTitle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
