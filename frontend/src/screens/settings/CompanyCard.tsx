import { useEffect, useRef, useState } from 'react';
import type { ApiCompanyDetails } from '../../lib/api';
import { MB_FORMAT, checkMb, checkPib } from '../../lib/serbianIds';
import { useStore } from '../../store/store';

/** Countries offered in Settings → Workspace (CD-167): Serbia first, it turns vacation decisions on. */
export const COUNTRIES = ['RS', 'BA', 'ME', 'MK', 'HR', 'SI', 'BG', 'RO', 'HU', 'GR', 'AL', 'AT', 'DE', 'CH', 'IT', 'FR', 'ES', 'NL', 'BE', 'PL', 'CZ', 'SK', 'SE', 'DK', 'NO', 'FI', 'IE', 'GB', 'US', 'CA'];
const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();
export const COUNTRY_OPTIONS = [{ value: '', label: 'Not set' }, ...COUNTRIES.map((c) => ({ value: c, label: regionName(c) }))];

type Key = keyof ApiCompanyDetails;

/**
 * The fields, with "e.g." examples that can't pass for saved values (CD-488) and, for the ids, the
 * format under the field instead of a placeholder.
 */
const FIELDS: { key: Exclude<Key, 'legalBasis'>; label: string; placeholder?: string; hint?: string; inputMode?: 'numeric' }[] = [
  { key: 'legalName', label: 'Legal name', placeholder: 'e.g. Primer d.o.o.' },
  { key: 'address', label: 'Address', placeholder: 'e.g. Street 1, 11000 Beograd' },
  { key: 'pib', label: 'PIB (tax ID)', hint: '9 digits. The last digit is a check digit.', inputMode: 'numeric' },
  { key: 'mb', label: 'MB (registration number)', hint: MB_FORMAT, inputMode: 'numeric' },
  { key: 'place', label: 'Place of issue', placeholder: 'e.g. Beograd' },
  { key: 'signatoryName', label: 'Signatory', placeholder: 'e.g. the director’s full name' },
  { key: 'signatoryTitle', label: 'Signatory title', placeholder: 'e.g. Direktor' },
];

type Draft = Record<Key, string>;
type FieldErrors = Partial<Record<Key, string>>;
const KEYS: Key[] = ['legalName', 'address', 'pib', 'mb', 'place', 'signatoryName', 'signatoryTitle', 'legalBasis'];
const draftOf = (c: ApiCompanyDetails): Draft => ({ legalName: c.legalName ?? '', address: c.address ?? '', pib: c.pib ?? '', mb: c.mb ?? '', place: c.place ?? '', signatoryName: c.signatoryName ?? '', signatoryTitle: c.signatoryTitle ?? '', legalBasis: c.legalBasis });
/** What is sent for a field: the ids without spaces ("104 052 135"), the rest trimmed. */
const sendable = (key: Key, value: string) => (key === 'pib' || key === 'mb' ? value.replace(/\s/g, '') : value.trim());

/** What is wrong with the draft, per field, in words (CD-487). PIB and MB may stay empty here. */
function problemsOf(d: Draft, saved: Draft): FieldErrors {
  const out: FieldErrors = {};
  if (d.pib.trim()) {
    const p = checkPib(d.pib);
    if (!p.ok) out.pib = p.error;
  }
  const mb = checkMb(d.mb);
  if (!mb.ok) out.mb = mb.error;
  const basis = d.legalBasis.trim();
  if (basis !== saved.legalBasis.trim() && basis.length < 10) out.legalBasis = 'The legal basis is needed on every decision; write at least 10 characters.';
  return out;
}

/**
 * Settings → Workspace → Company details (CD-167, spec 10.1): printed on generated documents such
 * as vacation decisions. Owners and admins edit; members read them. Like the rest of General, a
 * field saves itself when you leave it (CD-488), unless it is wrong: PIB and MB are checked as you
 * type (the same rules as the server, CD-487) and a wrong field stays unsaved until it is fixed.
 */
export function CompanyCard() {
  const { s, saveCompany, canEditWorkspace } = useStore();
  const company = s.workspace.company;
  const saved = draftOf(company);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(0);
  const [status, setStatus] = useState<'saved' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  // A save (or someone else's) brings new values: take them for the fields not being edited.
  const lastSaved = useRef(saved);
  useEffect(() => {
    const before = lastSaved.current;
    const now = draftOf(company);
    lastSaved.current = now;
    setDraft((d) => Object.fromEntries(KEYS.map((k) => [k, d[k] === before[k] ? now[k] : d[k]])) as Draft);
  }, [company]);
  const ro = !canEditWorkspace;
  const errors: FieldErrors = { ...serverErrors, ...problemsOf(draft, saved) };
  const edit = (key: Key, value: string) => {
    setDraft({ ...draft, [key]: value });
    if (serverErrors[key]) setServerErrors({ ...serverErrors, [key]: undefined });
    setProblem(null);
    setStatus(null);
  };
  /** Leaving a field saves it when it changed and is right. */
  const commit = async (key: Key) => {
    const value = sendable(key, draft[key]);
    if (ro || errors[key] || value === sendable(key, saved[key])) return;
    setSaving((n) => n + 1);
    setStatus(null);
    const refused = await saveCompany({ [key]: value });
    setSaving((n) => n - 1);
    if (refused) {
      setServerErrors((e) => ({ ...e, ...refused.fields }));
      setProblem(refused.message);
    } else setStatus('saved');
  };
  const fieldError = (key: Key) =>
    errors[key] ? (
      <span className="emp-error" data-testid={`company-${key}-error`}>
        {errors[key]}
      </span>
    ) : null;
  const unsaved = KEYS.some((k) => errors[k] && sendable(k, draft[k]) !== sendable(k, saved[k]));
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }} data-testid="company-details">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Company details</span>
        <span className="emp-note">
          Printed on generated documents.{s.workspace.country === 'RS' ? ' Vacation decisions need all of them; without them a decision fails and the Admins are emailed.' : ' Set the country to Serbia to issue vacation decisions.'}
        </span>
      </div>
      <div className="company-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className="policy-field">
            <span className="th">{f.label}</span>
            <input
              className="form-input"
              value={draft[f.key]}
              placeholder={f.placeholder}
              inputMode={f.inputMode}
              disabled={ro}
              aria-invalid={!!errors[f.key]}
              onChange={(e) => edit(f.key, e.target.value)}
              onBlur={() => void commit(f.key)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              data-testid={`company-${f.key}`}
            />
            {fieldError(f.key) ?? (f.hint && !ro && <span className="emp-note">{f.hint}</span>)}
          </label>
        ))}
      </div>
      <label className="policy-field">
        <span className="th">Legal basis on decisions</span>
        <textarea className="form-input" rows={3} value={draft.legalBasis} disabled={ro} aria-invalid={!!errors.legalBasis} onChange={(e) => edit('legalBasis', e.target.value)} onBlur={() => void commit('legalBasis')} data-testid="company-legalBasis" />
        {fieldError('legalBasis')}
        <span className="emp-note">Follows "Na osnovu". Update it when the Labor Law's gazette numbers change.</span>
      </label>
      {problem && (
        <span className="emp-error" role="alert">
          {problem}
        </span>
      )}
      <span className="emp-note" role="status" data-testid="company-status">
        {ro ? 'Only owners and admins can change the company details.' : saving ? 'Saving…' : unsaved ? 'Not saved yet: fix the fields marked in red.' : status === 'saved' ? 'Saved.' : 'Each field is saved when you leave it.'}
      </span>
    </div>
  );
}
