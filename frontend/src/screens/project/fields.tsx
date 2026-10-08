import { useEffect, useState } from 'react';

/** Inline fields of the record pages (project, task): ghost inputs that save on blur. */

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** A number that saves when it loses focus (Enter too); empty clears it; Escape puts the saved value back. */
export function NumberField({
  value,
  onSave,
  label,
  testId,
  disabled,
  step,
  placeholder,
}: {
  value: string | null;
  onSave: (v: number | null) => Promise<boolean>;
  label: string;
  testId?: string;
  disabled?: boolean;
  step: number;
  placeholder?: string;
}) {
  const shown = value == null ? '' : String(Number(value));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === shown) return;
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) return setDraft(shown);
    if (!(await onSave(next))) setDraft(shown);
  };
  return (
    <input
      className="ghost ghost-sm"
      type="number"
      min={0}
      step={step}
      aria-label={label}
      data-testid={testId}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(shown);
      }}
      style={{ flex: 1, minWidth: 0 }}
    />
  );
}

/** Text that saves when it loses focus (Enter too, unless multi-line); Escape puts the saved value back. */
export function TextField({
  value,
  onSave,
  label,
  className,
  testId,
  disabled,
  placeholder,
  maxLength,
  multiline,
  required,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  label: string;
  className: string;
  testId?: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => {
    const next = draft.trim();
    if (next === value.trim()) return setDraft(value);
    if (required && !next) return setDraft(value);
    if (!(await onSave(next))) setDraft(value);
  };
  const common = {
    className,
    'aria-label': label,
    'data-testid': testId,
    value: draft,
    disabled,
    placeholder,
    maxLength,
    onBlur: () => void commit(),
  };
  return multiline ? (
    <textarea {...common} rows={3} style={{ resize: 'vertical', lineHeight: 1.5, flex: 1 }} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setDraft(value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}
