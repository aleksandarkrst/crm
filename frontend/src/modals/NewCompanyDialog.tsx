import { useRef, useState } from 'react';
import { askConfirm } from '../components/ConfirmDialog';
import { paths } from '../lib/paths';
import { pibProblem } from '../lib/serbianIds';
import { Dropdown, Modal } from '../screens/settings/parts';
import { INDUSTRIES } from '../store/seed';
import { useStore } from '../store/store';

/**
 * New company (CD-533, board C-Companies): a name, and the PIB and industry if they are at hand.
 * It starts as a lead with you as its owner, and the company page opens. A PIB is checked as it is
 * typed (9 digits and the check digit); one the workspace already has names that company, with a
 * link to it, here and again from the API (a 409) if someone added it meanwhile.
 */
export function NewCompanyDialog() {
  const { s, set, session, navigate, createCompany } = useStore();
  const [name, setName] = useState('');
  const [pib, setPib] = useState('');
  const [industry, setIndustry] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ error: string; existingId?: string } | null>(null);

  const cleanPib = pib.replace(/\s/g, '');
  // Optional: only a PIB that was typed is checked, once it is long enough or on Create.
  const pibError = cleanPib && (touched || cleanPib.length >= 9) ? pibProblem(cleanPib) : null;
  const taken = cleanPib && !pibError ? s.extraCompanies.find((c) => c.id && c.pib === cleanPib) : undefined;
  const existing = taken ? { id: taken.id!, name: taken.name } : failed?.existingId ? { id: failed.existingId, name: s.extraCompanies.find((c) => c.id === failed.existingId)?.name ?? 'another company' } : null;
  const close = () => set({ newCompanyOpen: false });
  // Escape, the backdrop and × ask before dropping what was typed (CD-490); Cancel doesn't.
  const asking = useRef(false);
  const dismiss = () => {
    if (!name && !pib && !industry) return close();
    if (asking.current) return;
    asking.current = true;
    void askConfirm({ title: 'Discard your changes?', message: 'What you entered here is not saved.', confirmLabel: 'Discard', danger: true }).then((ok) => {
      asking.current = false;
      if (ok) close();
    });
  };
  const open = (id: string) => {
    close();
    navigate(paths.company(id));
  };

  const create = async () => {
    setTouched(true);
    setFailed(null);
    if (busy || !name.trim() || (cleanPib && pibProblem(cleanPib)) || taken) return;
    setBusy(true);
    const result = await createCompany({ name: name.trim(), pib: cleanPib || null, industry: industry || null, ownerUserId: session.userId });
    setBusy(false);
    if (!result.ok) setFailed(result);
  };

  return (
    <Modal
      title="New company"
      desc="It starts as a lead. Pultly makes it an opportunity by itself once all seven checks are done: name, PIB, MB, address, activity code, owner and a contact with a role in the decision."
      onClose={dismiss}
      testId="new-company-dialog"
    >
      <label className="gs-label">
        Name
        <input
          className="gs-input"
          data-testid="new-company-name"
          autoFocus
          placeholder="Company name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
        />
      </label>
      <div className="td-dialog-row">
        <label className="gs-label">
          <span>
            PIB <span className="gs-sub">(optional)</span>
          </span>
          <input className="gs-input" data-testid="new-company-pib" inputMode="numeric" placeholder="9 digits" value={pib} aria-invalid={!!pibError || !!existing} onChange={(e) => setPib(e.target.value)} />
        </label>
        <div className="gs-label">
          Industry
          <Dropdown label="Industry" value={industry} placeholder="Pick an industry" options={[{ value: '', label: 'Not set' }, ...INDUSTRIES.map((i) => ({ value: i, label: i }))]} onChange={setIndustry} width="100%" testId="new-company-industry" />
        </div>
      </div>
      {pibError && (
        <span className="gs-error" role="alert">
          {pibError}
        </span>
      )}
      {existing && (
        <span className="gs-error" role="alert" data-testid="new-company-pib-taken">
          This PIB belongs to {existing.name}.{' '}
          <button type="button" className="cl-link" onClick={() => open(existing.id)}>
            Open it
          </button>
        </span>
      )}
      {failed && !failed.existingId && (
        <span className="gs-error" role="alert" data-testid="new-company-error">
          {failed.error}
        </span>
      )}
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" data-testid="new-company-create" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create company'}
        </button>
      </div>
    </Modal>
  );
}
