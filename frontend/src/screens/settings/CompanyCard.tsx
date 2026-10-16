import { useEffect, useState } from 'react';
import type { ApiCompanyDetails } from '../../lib/api';
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

const FIELDS: { key: Exclude<keyof ApiCompanyDetails, 'legalBasis'>; label: string; placeholder: string; inputMode?: 'numeric' }[] = [
  { key: 'legalName', label: 'Legal name', placeholder: 'West Balkans Machinery d.o.o.' },
  { key: 'address', label: 'Address', placeholder: 'Bulevar oslobođenja 12, 21000 Novi Sad' },
  { key: 'pib', label: 'PIB (tax ID)', placeholder: '9 digits', inputMode: 'numeric' },
  { key: 'mb', label: 'MB (registration number)', placeholder: '8 digits', inputMode: 'numeric' },
  { key: 'place', label: 'Place of issue', placeholder: 'Novi Sad' },
  { key: 'signatoryName', label: 'Signatory', placeholder: 'Petar Jovanović' },
  { key: 'signatoryTitle', label: 'Signatory title', placeholder: 'Direktor' },
];

type Draft = Record<keyof ApiCompanyDetails, string>;
const draftOf = (c: ApiCompanyDetails): Draft => ({ legalName: c.legalName ?? '', address: c.address ?? '', pib: c.pib ?? '', mb: c.mb ?? '', place: c.place ?? '', signatoryName: c.signatoryName ?? '', signatoryTitle: c.signatoryTitle ?? '', legalBasis: c.legalBasis });

/**
 * Settings → Workspace → Company details (CD-167, spec 10.1): printed on generated documents such
 * as vacation decisions. Owners and admins edit and save; members read them. PIB and MB are
 * checked by the server (check digits).
 */
export function CompanyCard() {
  const { s, saveCompany, canEditWorkspace, flash } = useStore();
  const company = s.workspace.company;
  const [draft, setDraft] = useState<Draft>(() => draftOf(company));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setDraft(draftOf(company)), [company]);
  const ro = !canEditWorkspace;
  const changed = JSON.stringify(draft) !== JSON.stringify(draftOf(company));
  const save = async () => {
    setBusy(true);
    setProblem(null);
    const error = await saveCompany({ ...draft, legalBasis: draft.legalBasis.trim() || undefined });
    if (error) setProblem(error);
    else flash('Company details saved');
    setBusy(false);
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="company-details">
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
            <input className="form-input" value={draft[f.key]} placeholder={f.placeholder} inputMode={f.inputMode} disabled={ro} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} data-testid={`company-${f.key}`} />
          </label>
        ))}
      </div>
      <label className="policy-field">
        <span className="th">Legal basis on decisions</span>
        <textarea className="form-input" rows={3} value={draft.legalBasis} disabled={ro} onChange={(e) => setDraft({ ...draft, legalBasis: e.target.value })} data-testid="company-legalBasis" />
        <span className="emp-note">Follows "Na osnovu". Update it when the Labor Law's gazette numbers change.</span>
      </label>
      {problem && (
        <span className="emp-error" role="alert">
          {problem}
        </span>
      )}
      {ro ? (
        <span className="emp-note">Only owners and admins can change the company details.</span>
      ) : (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy || !changed} onClick={() => setDraft(draftOf(company))}>
            Discard
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={() => void save()} data-testid="company-save">
            Save
          </button>
        </div>
      )}
    </div>
  );
}
