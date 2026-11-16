import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';

/**
 * The building blocks of Workspace settings (CD-524 spec, section 4; design G-Settings): sections,
 * blocks and glass cards of setting rows, summary rows that open a modal, switches, segmented
 * controls, dropdowns, inputs that save on blur, tables with a ⋯ menu, tags with an add button,
 * modals, the confirm dialog and the side drawer. Styles are the `gs-*` rules in global.css.
 */

const chevron = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 10l5 5 5-5" />
  </svg>
);
const xIcon = (size = 13) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * What is open, innermost last (menus, modals, the drawer, confirms): Escape closes only the top
 * one, so closing a dropdown inside a modal leaves the modal open.
 */
const escapeStack: object[] = [];
function useEscape(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const token = {};
    escapeStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || escapeStack[escapeStack.length - 1] !== token) return;
      e.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      escapeStack.splice(escapeStack.indexOf(token), 1);
    };
  }, [active]);
}

/** Closes a menu when a click lands outside its button and its list, or Escape is pressed. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const latest = useRef(close);
  latest.current = close;
  useEscape(open, close);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menu.current?.contains(t)) latest.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return { ref, menu };
}

/**
 * A menu floating over everything (portalled, fixed): under its button, right-aligned, or above it
 * when there's no room below. Cards and tables can't clip it, and it follows scrolling.
 */
function FloatMenu({ anchor, menu, children, role, label, id, minWidth }: { anchor: React.RefObject<HTMLDivElement | null>; menu: React.RefObject<HTMLDivElement | null>; children: ReactNode; role: string; label?: string; id?: string; minWidth?: number }) {
  const [box, setBox] = useState<DOMRect | null>(() => anchor.current?.getBoundingClientRect() ?? null);
  useEffect(() => {
    const place = () => setBox(anchor.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);
  if (!box) return null;
  const below = window.innerHeight - box.bottom > 280 || box.top < 280;
  const style: React.CSSProperties = { right: Math.max(8, window.innerWidth - box.right), minWidth: Math.max(minWidth ?? 0, box.width), ...(below ? { top: box.bottom + 6 } : { bottom: window.innerHeight - box.top + 6 }) };
  return createPortal(
    <div className="gs-tokens">
      <div ref={menu} className="gs-menu gs-float" role={role} aria-label={label} id={id} style={style}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- page structure

/** A section of a page: its header (19 px title, one line, an optional primary button), then its blocks. */
export function Section({ title, desc, action, children, testId }: { title: string; desc?: ReactNode; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="gs-section" data-testid={testId} aria-label={title}>
      <div className="gs-section-head">
        <div className="text">
          <h2>{title}</h2>
          {desc && <span className="gs-sub">{desc}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A block inside a section: an optional 15 px heading with its buttons, over a card, table or list. */
export function Block({ title, desc, actions, children, testId }: { title?: ReactNode; desc?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="gs-block" data-testid={testId}>
      {(title || desc || actions) && (
        <div className="gs-block-head">
          <div className="text">
            {title && <h3>{title}</h3>}
            {desc && <span className="gs-sub">{desc}</span>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** A glass card; `danger` is the pale red one. */
export function Card({ children, danger, testId }: { children: ReactNode; danger?: boolean; testId?: string }) {
  return (
    <div className={'gs-card gs-glass' + (danger ? ' danger' : '')} data-testid={testId}>
      {children}
    </div>
  );
}

/** A quiet line under a block, with an optional link. */
export function Note({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="gs-note" data-testid={testId}>
      {children}
    </p>
  );
}

/** Settings that are visible but can't be used (their module is off): dimmed, not clickable, not focusable. */
export function Disabled({ off, children }: { off: boolean; children: ReactNode }) {
  if (!off) return <>{children}</>;
  return (
    <div className="gs-disabled" aria-disabled="true" inert>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- rows

/** A setting: label and description (or what is wrong) on the left, the control on the right. */
export function Row({
  label,
  desc,
  summary,
  error,
  icon,
  sub,
  dim,
  switchRow,
  children,
  testId,
  setting,
  data,
}: {
  label: ReactNode;
  desc?: ReactNode;
  /** The current values as one bold line (a summary row). */
  summary?: ReactNode;
  error?: ReactNode;
  icon?: ReactNode;
  /** Depends on the row above: indented with a connector line. */
  sub?: boolean;
  /** The row it depends on is off: dimmed and not clickable. */
  dim?: boolean;
  /** The control is a switch: it stays on the right on a phone. */
  switchRow?: boolean;
  children?: ReactNode;
  testId?: string;
  setting?: string;
  data?: Record<`data-${string}`, string>;
}) {
  return (
    <div className={'gs-row' + (sub ? ' sub' : '') + (dim ? ' dim' : '') + (switchRow ? ' switch-row' : '')} data-testid={testId} data-setting={setting} {...data}>
      {icon}
      <div className="gs-row-text">
        <b>{label}</b>
        {desc && <span className="gs-sub">{desc}</span>}
        {summary && <span className="gs-row-summary">{summary}</span>}
        {error && (
          <span className="gs-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {children !== undefined && <div className="gs-row-control">{children}</div>}
    </div>
  );
}

/** A summary row: the current values in bold and an Edit button that opens a modal. */
export function SummaryRow({ label, desc, summary, onEdit, testId, disabled }: { label: string; desc?: ReactNode; summary: ReactNode; onEdit: () => void; testId?: string; disabled?: boolean }) {
  return (
    <Row label={label} desc={desc} summary={summary} testId={testId}>
      <button type="button" className="gs-btn" aria-label={`Edit ${label.toLowerCase()}`} disabled={disabled} onClick={onEdit}>
        Edit
      </button>
    </Row>
  );
}

// ---------------------------------------------------------------- controls

export function Switch({ on, onChange, label, disabled, testId }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={'gs-switch' + (on ? ' on' : '')} disabled={disabled} data-testid={testId} onClick={() => onChange(!on)} />;
}

/** One of a few options side by side. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  testId,
}: {
  value: T;
  options: readonly { value: T; label: string; testId?: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <span className="gs-seg" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} disabled={disabled} data-testid={o.testId} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export type Opt<T extends string = string> = { value: T; label: string };

/** A button with the current value; its list is a glass menu with a check on the chosen option. Arrows, Enter and Escape work. */
export function Dropdown<T extends string>({ value, options, onChange, label, width = 240, disabled, testId }: { value: T; options: readonly Opt<T>[]; onChange: (v: T) => void; label: string; width?: number | string; disabled?: boolean; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { ref, menu } = useDismiss(open, () => setOpen(false));
  const listId = useId();
  const current = options.find((o) => o.value === value);
  const pick = (v: T) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && options[active]) pick(options[active].value);
    else return;
    e.preventDefault();
  };
  return (
    <div className="gs-dd" ref={ref} style={{ width }}>
      <button
        type="button"
        className="gs-ddb"
        style={{ width: '100%' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? 'not set'}`}
        disabled={disabled}
        data-testid={testId}
        data-value={value}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen(!open);
        }}
        onKeyDown={onKey}
      >
        <span className="v">{current?.label ?? '—'}</span>
        {chevron}
      </button>
      {open && (
        <FloatMenu anchor={ref} menu={menu} role="listbox" id={listId} label={label}>
          {options.map((o, i) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={'gs-opt' + (o.value === value ? ' on' : '') + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}>
              <span>{o.label}</span>
              <span className="ok">
                <Icon name="check" size={12} />
              </span>
            </button>
          ))}
        </FloatMenu>
      )}
    </div>
  );
}

/**
 * A text field that saves when it is left or on Enter, not per keystroke (spec 5). An invalid value
 * isn't saved and keeps its error; the error clears as soon as the value is right again.
 */
export function TextField({
  value,
  onSave,
  validate,
  label,
  width = 240,
  placeholder,
  inputMode,
  maxLength,
  disabled,
  testId,
  type = 'text',
  small = true,
}: {
  value: string;
  onSave: (v: string) => void;
  /** What is wrong with a value, or '' when it can be saved. */
  validate?: (v: string) => string;
  label: string;
  width?: number | string;
  placeholder?: string;
  inputMode?: 'numeric' | 'decimal' | 'email' | 'text';
  maxLength?: number;
  disabled?: boolean;
  testId?: string;
  type?: 'text' | 'time' | 'number';
  small?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [tried, setTried] = useState(false);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const problem = validate?.(draft) ?? '';
  const commit = () => {
    if (draft === value) return;
    if (problem) return setTried(true);
    onSave(draft);
  };
  const shown = tried || (draft !== value && problem) ? problem : '';
  return (
    <span className="gs-field" style={{ width }}>
      <input
        className={'gs-input' + (small ? ' s' : '')}
        type={type}
        aria-label={label}
        aria-invalid={!!shown}
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          setDraft(e.target.value);
          if (tried && !validate?.(e.target.value)) setTried(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {shown && (
        <span className="gs-error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {shown}
        </span>
      )}
    </span>
  );
}

export function Unit({ children }: { children: ReactNode }) {
  return <span className="gs-unit">{children}</span>;
}

export function Badge({ tone, children }: { tone?: 'green' | 'blue' | 'violet' | 'amber' | 'red'; children: ReactNode }) {
  return <span className={'gs-badge' + (tone ? ' ' + tone : '')}>{children}</span>;
}

/** A remove × button. */
export function RemoveX({ label, onClick, disabled, title, testId }: { label: string; onClick: () => void; disabled?: boolean; title?: string; testId?: string }) {
  return (
    <button type="button" className="gs-x" aria-label={label} title={title ?? label} disabled={disabled} data-testid={testId} onClick={onClick}>
      {xIcon()}
    </button>
  );
}

/** A checkbox button ("All to-dos done"). */
export function CheckButton({ on, label, onChange, disabled, title }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={'gs-check' + (on ? ' on' : '')} aria-pressed={on} disabled={disabled} title={title} onClick={() => onChange(!on)}>
      <span className="box">
        <Icon name="check" size={12} />
      </span>
      {label}
    </button>
  );
}

/** The weekdays as toggles. `days` holds 1 (Monday) to 7 (Sunday). */
export function DayToggles({ days, onChange }: { days: readonly number[]; onChange: (days: number[]) => void }) {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return (
    <span className="gs-days" role="group" aria-label="Working days" data-testid="working-days">
      {names.map((n, i) => {
        const d = i + 1;
        const on = days.includes(d);
        return (
          <button key={n} type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={n} title={n} data-day={n.slice(0, 3)} onClick={() => onChange(on ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b))}>
            {n[0]}
          </button>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------- tables, menus, tags

/** A table in a glass card. */
export function Table({ cols, children, empty, minWidth, testId }: { cols: { label: ReactNode; align?: 'num' | 'center' | 'end' }[]; children?: ReactNode; empty?: ReactNode; minWidth?: number; testId?: string }) {
  return (
    <div className="gs-card gs-glass gs-table" data-testid={testId}>
      <table style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} className={c.align}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <div className="gs-table-empty">{empty}</div>}
    </div>
  );
}

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; testId?: string };

/** The ⋯ button of a row and its menu (32 px items; destructive ones are red and last). */
export function RowMenu({ label, items, testId }: { label: string; items: MenuItem[]; testId?: string }) {
  const [open, setOpen] = useState(false);
  const { ref, menu } = useDismiss(open, () => setOpen(false));
  if (!items.length) return null;
  return (
    <div className="gs-dd" ref={ref}>
      <button type="button" className="gs-x plain" aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid={testId} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <FloatMenu anchor={ref} menu={menu} role="menu" label={label} minWidth={190}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={'gs-opt' + (it.danger ? ' red' : '')}
              data-testid={it.testId}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </FloatMenu>
      )}
    </div>
  );
}

/**
 * Tags with a remove × and a dashed "+ Add" pill; no input shows until it is clicked. Enter adds,
 * Escape cancels, leaving the input with text adds.
 */
export function Tags({
  items,
  onRemove,
  onAdd,
  onRename,
  addLabel,
  empty,
  disabled,
  testId,
}: {
  items: { key: string; label: string }[];
  onRemove: (index: number) => void;
  onAdd: (label: string) => void;
  /** Optional: clicking a tag edits its text in place (to-dos keep being renamable, CD-363). */
  onRename?: (index: number, label: string) => void;
  addLabel: string;
  empty?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // Escape cancels: the blur that follows the input leaving must not add the text after all.
  const cancelled = useRef(false);
  const done = (add: boolean) => {
    const t = draft.trim();
    if (add && t) onAdd(t);
    setDraft('');
    setAdding(false);
  };
  return (
    <div className="gs-tags" data-testid={testId}>
      {items.map((t, i) => (
        <span key={t.key} className="gs-tag">
          {onRename && !disabled ? (
            <input className="gs-tag-text" aria-label="To-do" value={t.label} onChange={(e) => onRename(i, e.target.value)} style={{ width: Math.max(6, Math.min(34, t.label.length + 1)) + 'ch' }} />
          ) : (
            t.label
          )}
          {!disabled && (
            <button type="button" aria-label={`Remove ${t.label}`} onClick={() => onRemove(i)}>
              {xIcon(12)}
            </button>
          )}
        </span>
      ))}
      {!items.length && empty && !adding && <span className="gs-sub">{empty}</span>}
      {!disabled &&
        (adding ? (
          <input
            className="gs-input"
            autoFocus
            aria-label={addLabel}
            placeholder={addLabel}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(true);
              if (e.key === 'Escape') {
                // Only the to-do is cancelled, not the drawer or modal around it.
                e.stopPropagation();
                cancelled.current = true;
                done(false);
              }
            }}
            onBlur={() => {
              if (cancelled.current) cancelled.current = false;
              else done(true);
            }}
          />
        ) : (
          <button type="button" className="gs-tag-add" onClick={() => setAdding(true)}>
            + {addLabel}
          </button>
        ))}
    </div>
  );
}

/** Numbered chips joined by arrows: the company down to Employee, a project type's stages. */
export function Preview({ names, testId }: { names: string[]; testId?: string }) {
  return (
    <div className="gs-card gs-glass gs-preview" data-testid={testId}>
      {names.map((n, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span className="gs-pst">
            <span className="gs-pn">{i + 1}</span>
            <span className="gs-pst-name">{n}</span>
          </span>
          {i < names.length - 1 && (
            <span className="gs-par" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- overlays

/** Escape closes; the first field (or button) takes the focus when it opens. */
function useOverlay(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  // Escape closes only the top overlay (a confirm over the drawer closes the confirm).
  useEscape(true, onClose);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('input:not([disabled]), select, textarea, button:not([disabled])');
    first?.focus();
    return () => before?.focus?.();
  }, []);
  return box;
}

/** A centred glass sheet with a title, a line and its content (portalled to body). */
export function Modal({ title, desc, onClose, children, wide, testId }: { title: string; desc?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; testId?: string }) {
  const box = useOverlay(onClose);
  return createPortal(
    <div className="gs-tokens">
      <div className="gs-scrim" onClick={onClose} />
      <div className="gs-dialog-wrap">
        <div ref={box} className={'gs-sheet gs-glass' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
          <h2>{title}</h2>
          {desc && <p className="gs-sub" style={{ margin: 0 }}>{desc}</p>}
          {children}
          <button type="button" className="gs-x plain gs-sheet-x" aria-label="Close" data-testid="gs-close" onClick={onClose}>
            {xIcon()}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A modal of setting rows that save as they change, closed with Done (a summary row's editor). */
export function RowsModal({ title, desc, onClose, children, testId }: { title: string; desc?: ReactNode; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <Modal title={title} desc={desc} onClose={onClose} wide testId={testId}>
      <div className="gs-card">{children}</div>
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/**
 * The confirm dialog: a red icon tile, the question, what happens, optional "Move them to" pills
 * (the next item preselected by the caller), then Cancel and a red button naming the action.
 */
export function Confirm({
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  move,
  blocked,
  icon = 'trash',
  testId,
}: {
  title: string;
  text: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  move?: { label: string; options: Opt[]; value: string; onPick: (v: string) => void };
  /** The tile: a bin for deletes, a lock for switching something off (its data is kept). */
  icon?: 'trash' | 'lock';
  /** The action can't run yet (the text says why): the red button is off. */
  blocked?: boolean;
  testId?: string;
}) {
  const box = useOverlay(onCancel);
  return createPortal(
    <div className="gs-tokens">
      <div className="gs-scrim confirm" onClick={onCancel} />
      <div className="gs-dialog-wrap confirm">
        <div ref={box} className="gs-sheet gs-glass confirm" role="alertdialog" aria-modal="true" aria-label={title} data-testid={testId}>
          <span className="gs-danger-tile" aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
          <h2>{title}</h2>
          <p className="gs-sub" style={{ margin: 0 }}>
            {text}
          </p>
          {move && (
            <div className="gs-label">
              {move.label}
              <span className="gs-move" role="radiogroup" aria-label={move.label}>
                {move.options.map((o) => (
                  <button key={o.value} type="button" role="radio" aria-checked={o.value === move.value} className={o.value === move.value ? 'on' : ''} onClick={() => move.onPick(o.value)}>
                    {o.label}
                  </button>
                ))}
              </span>
            </div>
          )}
          <div className="gs-sheet-actions">
            <button type="button" className="gs-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="gs-btn red" data-testid="gs-confirm" disabled={blocked || (!!move && !move.value)} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
          <button type="button" className="gs-x plain gs-sheet-x" aria-label="Close" data-testid="gs-close" onClick={onCancel}>
            {xIcon()}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}


type Ask = { title: string; text: ReactNode; confirmLabel: string };
let showAsk: ((a: (Ask & { resolve: (ok: boolean) => void }) | null) => void) | null = null;

/**
 * Asks with the glass confirm (CD-524 review): resolves true on the red button, false on Cancel,
 * the X, Escape or the scrim. Shown by the GlassConfirmHost in the Settings shell, so it still
 * works after the sheet that asked has closed.
 */
export function askGlassConfirm(a: Ask): Promise<boolean> {
  return new Promise((resolve) => (showAsk ? showAsk({ ...a, resolve }) : resolve(false)));
}

/** Renders askGlassConfirm's question; mounted once by the Settings shell. */
export function GlassConfirmHost() {
  const [ask, setAsk] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null);
  useEffect(() => {
    showAsk = setAsk;
    return () => {
      showAsk = null;
    };
  }, []);
  if (!ask) return null;
  const answer = (ok: boolean) => {
    ask.resolve(ok);
    setAsk(null);
  };
  return <Confirm title={ask.title} text={ask.text} confirmLabel={ask.confirmLabel} onConfirm={() => answer(true)} onCancel={() => answer(false)} testId="glass-confirm" />;
}
/** The side drawer: fixed to the right, its own header, a scrolling body and Done. */
export function Drawer({ label, head, onClose, children, foot, testId }: { label: string; head: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; testId?: string }) {
  const box = useOverlay(onClose);
  return createPortal(
    <div className="gs-tokens">
      <div className="gs-drawer-scrim" onClick={onClose} />
      <aside ref={box} className="gs-drawer" role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
        <div className="gs-drawer-head">
          <div className="titles">{head}</div>
          <button type="button" className="gs-x plain" aria-label="Close" onClick={onClose}>
            {xIcon()}
          </button>
        </div>
        <div className="gs-drawer-body">{children}</div>
        <div className="gs-drawer-foot">
          {foot ?? (
            <button type="button" className="gs-btn primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
