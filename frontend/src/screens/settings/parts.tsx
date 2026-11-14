import type { ReactNode } from 'react';

/**
 * The building blocks of Workspace settings (CD-524, design G-Settings): a page is a column of
 * blocks; a block has a heading (with its own buttons) over a card of rows, a table or a list; a
 * row is a setting, with what it is on the left and its control on the right.
 */

/** A block: a heading, a line under it and buttons on the right, over its content. */
export function Block({ title, desc, actions, children, testId }: { title?: ReactNode; desc?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="ws-block" data-testid={testId}>
      {(title || desc || actions) && (
        <div className="ws-block-head">
          <div className="ws-block-text">
            {title && <h3 className="ws-block-title">{title}</h3>}
            {desc && <span className="ws-block-desc">{desc}</span>}
          </div>
          {actions && <div className="ws-block-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A card of rows. `danger` for the destructive ones. */
export function Rows({ children, danger, testId }: { children: ReactNode; danger?: boolean; testId?: string }) {
  return (
    <div className={'card ws-rows' + (danger ? ' danger' : '')} data-testid={testId}>
      {children}
    </div>
  );
}

/** One setting: label, hint (or what is wrong with it) and the control. */
export function Row({
  label,
  hint,
  error,
  icon,
  children,
  testId,
  setting,
  switchRow,
  data,
}: {
  /** Extra data-* attributes, e.g. `{ 'data-module': 'crm' }`. */
  data?: Record<`data-${string}`, string>;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  testId?: string;
  setting?: string;
  /** The control is a switch: it stays on the right on a phone. */
  switchRow?: boolean;
}) {
  return (
    <div className={'ws-row' + (switchRow ? ' with-switch' : '')} data-testid={testId} data-setting={setting} {...data}>
      {icon}
      <div className="ws-row-text">
        <span className="ws-row-label">{label}</span>
        {hint && <span className="ws-row-hint">{hint}</span>}
        {error && (
          <span className="ws-row-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {children !== undefined && <div className="ws-row-control">{children}</div>}
    </div>
  );
}

/** One of a few options side by side (the design's segmented control). */
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
    <span className="ws-seg" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} disabled={disabled} data-testid={o.testId} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A quiet line under a block. */
export function Note({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="ws-note" data-testid={testId}>
      {children}
    </p>
  );
}

/** A unit after a number field ("days", "%"). */
export function Unit({ children }: { children: ReactNode }) {
  return <span className="ws-unit">{children}</span>;
}

/** A table in a card: column heads, then the rows (`<tr>`s). */
export function Table({ cols, children, empty, testId, minWidth }: { cols: { label: ReactNode; align?: 'num' | 'center' | 'actions' }[]; children: ReactNode; empty?: ReactNode; testId?: string; minWidth?: number }) {
  return (
    <div className="card ws-table" data-testid={testId}>
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
      {empty && <div className="ws-table-empty">{empty}</div>}
    </div>
  );
}

/** The ✕ button of a row or chip. */
export function RemoveX({ label, onClick, disabled, title, testId, plain }: { label: string; onClick: () => void; disabled?: boolean; title?: string; testId?: string; plain?: boolean }) {
  return (
    <button type="button" className={'ws-x' + (plain ? ' plain' : '')} aria-label={label} title={title ?? label} disabled={disabled} data-testid={testId} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/** Up / down arrows as icon buttons. */
export function MoveButton({ dir, label, onClick, disabled, testId }: { dir: 'up' | 'down'; label: string; onClick: () => void; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" className="ws-x plain" aria-label={label} title={label} disabled={disabled} data-testid={testId} onClick={onClick}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
      </svg>
    </button>
  );
}

/** Numbered chips joined by arrows: the stages of a type, the levels of the organization. */
export function StagePreview({ names, testId }: { names: string[]; testId?: string }) {
  return (
    <div className="card ws-preview" data-testid={testId}>
      {names.map((n, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span className="ws-preview-stage">
            <span className="ws-preview-n">{i + 1}</span>
            <span className="ws-preview-name">{n}</span>
          </span>
          {i < names.length - 1 && (
            <span className="ws-preview-arrow" aria-hidden="true">
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
