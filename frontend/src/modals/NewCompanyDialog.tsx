import { useState } from 'react';
import { Modal, ModalHeader } from '../components/ui';
import type { ApiOwnership } from '../lib/api';
import { paths } from '../lib/paths';
import { mbValid, pibProblem } from '../lib/serbianIds';
import { INDUSTRIES, SOURCES } from '../store/seed';
import { memberLabels } from '../store/selectors';
import { useStore } from '../store/store';

/**
 * New company (CD-357): the name and the PIB are required, the rest can wait. It starts as a lead.
 * The PIB is checked here as the user types (digits and check digit) and by the API (unique in the
 * workspace); a PIB the workspace already has offers the existing company instead.
 */
export function NewCompanyDialog() {
  const { s, set, session, navigate, createCompany } = useStore();
  const [name, setName] = useState('');
  const [pib, setPib] = useState('');
  const [mb, setMb] = useState('');
  const [industry, setIndustry] = useState('');
  const [ownership, setOwnership] = useState<ApiOwnership | ''>('');
  const [owner, setOwner] = useState(session.userId);
  const [source, setSource] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ error: string; existingId?: string } | null>(null);

  const cleanPib = pib.replace(/\s/g, '');
  const cleanMb = mb.replace(/\s/g, '');
  const pibError = touched || cleanPib.length >= 9 ? pibProblem(cleanPib) : null;
  const mbError = cleanMb && (touched || cleanMb.length >= 8) && !mbValid(cleanMb) ? 'An MB has 8 digits with a valid check digit.' : null;
  const nameError = touched && !name.trim() ? 'The company name is required.' : null;
  const owners = [...memberLabels(s)].map(([value, label]) => ({ value, label: value === session.userId ? `${label} (me)` : label }));
  const close = () => set({ newCompanyOpen: false });

  const create = async () => {
    setTouched(true);
    setFailed(null);
    if (!name.trim() || pibProblem(cleanPib) || (cleanMb && !mbValid(cleanMb))) return;
    setBusy(true);
    const result = await createCompany({
      name: name.trim(),
      pib: cleanPib,
      mb: cleanMb || null,
      industry: industry || null,
      ownershipType: ownership || null,
      source: source || null,
      ownerUserId: owner || null,
    });
    setBusy(false);
    if (!result.ok) setFailed(result);
  };

  return (
    <Modal maxWidth={560} gap={18}>
      <ModalHeader title="New company" sub="Every company starts as a lead. The name and PIB are required; the rest can wait until it becomes an opportunity." />
      <label className="form-label">
        Company name
        <input className="form-input" data-testid="new-company-name" autoFocus value={name} placeholder="Name as registered in APR" aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} />
        {nameError && (
          <span className="subform-hint" role="alert" style={{ color: 'var(--danger)' }}>
            {nameError}
          </span>
        )}
        <span className="subform-hint">Use the exact name from the APR register (Agencija za privredne registre).</span>
      </label>
      <div className="policy-field-row">
        <label className="form-label">
          Company ID (PIB)
          <input className="form-input" data-testid="new-company-pib" inputMode="numeric" placeholder="9 digits" value={pib} aria-invalid={!!pibError} onChange={(e) => setPib(e.target.value)} style={pibError ? { borderColor: 'var(--danger)' } : undefined} />
          {pibError && (
            <span className="subform-hint" role="alert" style={{ color: 'var(--danger)' }}>
              {pibError}
            </span>
          )}
          <span className="subform-hint">The company's ID in Pultly. No two companies can share it.</span>
        </label>
        <label className="form-label">
          Matični broj
          <input className="form-input" data-testid="new-company-mb" inputMode="numeric" placeholder="8 digits, optional for a lead" value={mb} aria-invalid={!!mbError} onChange={(e) => setMb(e.target.value)} style={mbError ? { borderColor: 'var(--danger)' } : undefined} />
          {mbError && (
            <span className="subform-hint" role="alert" style={{ color: 'var(--danger)' }}>
              {mbError}
            </span>
          )}
        </label>
      </div>
      <div className="policy-field-row">
        <label className="form-label">
          Industry
          <select className="form-input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">Not set</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Ownership
          <select className="form-input" data-testid="new-company-ownership" value={ownership} onChange={(e) => setOwnership(e.target.value as ApiOwnership | '')}>
            <option value="">Not set</option>
            <option value="private">Private</option>
            <option value="state">State</option>
          </select>
        </label>
      </div>
      <div className="policy-field-row">
        <label className="form-label">
          Owner
          <select className="form-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Source
          <select className="form-input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Not set</option>
            {SOURCES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      {failed ? (
        <div className="notice-warn" role="alert" data-testid="new-company-error">
          <span>{failed.error}</span>
          {failed.existingId && (
            <span>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  close();
                  navigate(paths.company(failed.existingId!));
                }}
              >
                Open the existing company
              </button>
            </span>
          )}
        </div>
      ) : (
        <div className="hint-box">A PIB already in the workspace can't be used again, so there are never two records for one firm.</div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" data-testid="new-company-create" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create lead'}
        </button>
      </div>
    </Modal>
  );
}
