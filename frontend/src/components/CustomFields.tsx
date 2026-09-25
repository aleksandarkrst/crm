/**
 * Custom fields (CD-15) on a deal, company or contact screen, and in the create dialogs. The
 * definitions and values come from the store; values save as you type (see setCustomValue).
 */
import type { CustomFieldEntity, CustomFieldPatch, CustomValue } from '../lib/api';
import { customFieldsOf } from '../store/selectors';
import { useStore } from '../store/store';
import type { CustomFieldDef } from '../store/types';
import { FieldRow, GhostInput, GhostSelect } from './ui';

/** The label of a field in a row: required fields get an asterisk. */
const labelOf = (f: CustomFieldDef) => (f.required ? f.label + ' *' : f.label);

/** One FieldRow per custom field of the record type, editable in place. */
export function CustomFieldRows({ entity, recordId }: { entity: CustomFieldEntity; recordId: string | null | undefined }) {
  const { s, setCustomValue } = useStore();
  const fields = customFieldsOf(s, entity);
  if (!recordId || fields.length === 0) return null;
  const values = s.customValues[entity][recordId] || {};
  return (
    <>
      {fields.map((f) => (
        <FieldRow key={f.id} label={labelOf(f)}>
          <CustomInput field={f} value={values[f.id]} ghost onChange={(v) => setCustomValue(entity, recordId, f, v)} />
        </FieldRow>
      ))}
    </>
  );
}

/** The input for one field; `ghost` for record screens, form inputs for dialogs. */
function CustomInput({ field: f, value, ghost, onChange }: { field: CustomFieldDef; value: CustomValue | undefined; ghost?: boolean; onChange: (v: CustomValue | null) => void }) {
  const text = value === undefined || value === null ? '' : String(value);
  const data = { 'data-custom-field': f.label };
  if (f.type === 'checkbox')
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: ghost ? '6px 9px' : '4px 0', fontSize: 13.5, cursor: 'pointer' }}>
        <input type="checkbox" {...data} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {value === true ? 'Yes' : 'No'}
      </label>
    );
  if (f.type === 'select') {
    const options = [{ value: '', label: '—' }, ...f.options.map((o) => ({ value: o.id, label: o.label }))];
    if (ghost) return <GhostSelect chevron {...data} value={text} onChange={(e) => onChange(e.target.value || null)} options={options} />;
    return (
      <select className="form-input" {...data} value={text} onChange={(e) => onChange(e.target.value || null)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text';
  const placeholder = f.type === 'url' ? 'https://…' : ghost ? '—' : undefined;
  const input = ghost ? (
    <GhostInput type={type} {...data} value={text} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="form-input" type={type} {...data} value={text} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
  if (f.type !== 'url' || !ghost || !text) return input;
  const href = /^https?:\/\//i.test(text) ? text : 'https://' + text;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {input}
      <a href={href} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12, color: 'var(--brand)', whiteSpace: 'nowrap' }}>
        Open
      </a>
    </span>
  );
}

/** Custom fields in a create dialog; the dialog keeps the values until it saves. */
export function CustomFieldInputs({ entity, values, onChange }: { entity: CustomFieldEntity; values: CustomFieldPatch; onChange: (next: CustomFieldPatch) => void }) {
  const { s } = useStore();
  const fields = customFieldsOf(s, entity);
  if (fields.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {fields.map((f) => (
        <label key={f.id} className="form-label">
          {labelOf(f)}
          <CustomInput field={f} value={values[f.id] ?? undefined} onChange={(v) => onChange({ ...values, [f.id]: v })} />
        </label>
      ))}
    </div>
  );
}

/**
 * The values a create dialog sends: numbers as numbers, empty ones left out. Returns the label of
 * a required field that is still empty, if any, instead.
 */
export function customFieldsForCreate(fields: CustomFieldDef[], values: CustomFieldPatch): { values: CustomFieldPatch } | { missing: string } {
  const out: CustomFieldPatch = {};
  for (const f of fields) {
    // An untouched checkbox is a "No".
    const v = f.type === 'checkbox' ? (values[f.id] ?? false) : values[f.id];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (f.required) return { missing: f.label };
      continue;
    }
    out[f.id] = f.type === 'number' && typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  }
  return { values: out };
}
