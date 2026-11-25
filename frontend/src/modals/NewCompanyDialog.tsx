import { useRef, useState, type ReactNode } from 'react';
import { askConfirm } from '../components/ConfirmDialog';
import type { ApiOwnership } from '../lib/api';
import { paths } from '../lib/paths';
import { checkActivityCode, mbProblem, pibProblem } from '../lib/serbianIds';
import { Dropdown, Modal } from '../screens/settings/parts';
import { INDUSTRIES } from '../store/seed';
import { allPeople } from '../store/selectors';
import { useStore } from '../store/store';

const NEW_CONTACT = '__new';

/**
 * New company (CD-533, board C-Companies). The name, PIB, Matični broj and Šifra delatnosti are
 * required; industry, ownership and a contact are optional. The contact is one already in the
 * workspace (it moves to the new company) or a new one by name. The company starts as a lead with
 * you as its owner, and its page opens. The IDs are checked as they are typed; a PIB the workspace
 * already has names that company, with a link to it, here and again from the API (a 409) if
 * someone added it meanwhile.
 */
export function NewCompanyDialog() {
  const { s, set, session, navigate, createCompany } = useStore();
  const [name, setName] = useState('');
  const [pib, setPib] = useState('');
  const [mb, setMb] = useState('');
  const [activityCode, setActivityCode] = useState('');
  const [industry, setIndustry] = useState('');
  const [ownership, setOwnership] = useState<ApiOwnership | ''>('');
  const [contact, setContact] = useState('');
  const [contactName, setContactName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ error: string; existingId?: string } | null>(null);

  const cleanPib = pib.replace(/\s/g, '');
  const cleanMb = mb.replace(/\s/g, '');
  const code = activityCode.trim();
  const required = (v: string, what: string) => (touched && !v ? `${what} is required.` : null);
  // Each ID is checked once it is long enough, and all of them on Create.
  const nameError = required(name.trim(), 'The company name');
  const pibError = required(cleanPib, 'The PIB') ?? (cleanPib && (touched || cleanPib.length >= 9) ? pibProblem(cleanPib) : null);
  const mbError = required(cleanMb, 'The Matični broj') ?? (cleanMb && (touched || cleanMb.length >= 8) ? mbProblem(cleanMb) : null);
  const codeCheck = checkActivityCode(code);
  const codeError = required(code, 'The Šifra delatnosti') ?? (code && (touched || code.length >= 4) && !codeCheck.ok ? codeCheck.error : null);
  const contactError = touched && contact === NEW_CONTACT && !contactName.trim() ? "Type the contact's name, or pick No contact." : null;
  const taken = cleanPib && !pibProblem(cleanPib) ? s.extraCompanies.find((c) => c.id && c.pib === cleanPib) : undefined;
  const existing = taken ? { id: taken.id!, name: taken.name } : failed?.existingId ? { id: failed.existingId, name: s.extraCompanies.find((c) => c.id === failed.existingId)?.name ?? 'another company' } : null;

  const people = allPeople(s).filter((p) => p.contactId);
  const movesFrom = contact && contact !== NEW_CONTACT ? people.find((p) => p.contactId === contact)?.company : undefined;
  const contacts = [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.contactId!, label: p.company ? `${p.name}, ${p.company}` : p.name }));

  const close = () => set({ newCompanyOpen: false });
  // Escape, the backdrop and × ask before dropping what was typed (CD-490); Cancel doesn't.
  const asking = useRef(false);
  const dismiss = () => {
    if (![name, pib, mb, activityCode, industry, ownership, contact].some(Boolean)) return close();
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
    const invalid = !name.trim() || !cleanPib || pibProblem(cleanPib) || !cleanMb || mbProblem(cleanMb) || !code || !codeCheck.ok || (contact === NEW_CONTACT && !contactName.trim());
    if (busy || invalid || taken) return;
    setBusy(true);
    const picked = contact === NEW_CONTACT ? { name: contactName.trim() } : contact ? { id: contact } : undefined;
    const result = await createCompany(
      { name: name.trim(), pib: cleanPib, mb: cleanMb, activityCode: code, industry: industry || null, ownershipType: ownership || null, ownerUserId: session.userId },
      picked,
    );
    setBusy(false);
    if (!result.ok) setFailed(result);
  };
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && name.trim() && void create();

  return (
    <Modal
      title="New company"
      desc="It starts as a lead. Pultly makes it an opportunity by itself once all seven checks are done: name, PIB, MB, address, activity code, owner and a contact with a role in the decision."
      onClose={dismiss}
      testId="new-company-dialog"
    >
      <Field label="Name" error={nameError}>
        <input className="gs-input" data-testid="new-company-name" autoFocus placeholder="Company name" value={name} maxLength={200} aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
      </Field>
      <div className="td-dialog-row">
        <Field label="Company ID (PIB)" error={pibError}>
          <input className="gs-input" data-testid="new-company-pib" inputMode="numeric" placeholder="9 digits" value={pib} aria-invalid={!!pibError || !!existing} onChange={(e) => setPib(e.target.value)} onKeyDown={onEnter} />
        </Field>
        <Field label="Matični broj" error={mbError}>
          <input className="gs-input" data-testid="new-company-mb" inputMode="numeric" placeholder="8 digits" value={mb} aria-invalid={!!mbError} onChange={(e) => setMb(e.target.value)} onKeyDown={onEnter} />
        </Field>
      </div>
      {existing && (
        <span className="gs-error" role="alert" data-testid="new-company-pib-taken">
          This PIB belongs to {existing.name}.{' '}
          <button type="button" className="cl-link" onClick={() => open(existing.id)}>
            Open it
          </button>
        </span>
      )}
      <div className="td-dialog-row">
        <Field label="Šifra delatnosti" error={codeError}>
          <input className="gs-input" data-testid="new-company-activity-code" inputMode="numeric" placeholder="4 digits, e.g. 6201" value={activityCode} aria-invalid={!!codeError} onChange={(e) => setActivityCode(e.target.value)} onKeyDown={onEnter} />
        </Field>
        <Field label="Ownership" optional div>
          <Dropdown
            label="Ownership"
            value={ownership}
            placeholder="Not set"
            options={[
              { value: '', label: 'Not set' },
              { value: 'private', label: 'Private' },
              { value: 'state', label: 'State' },
            ]}
            onChange={setOwnership}
            width="100%"
            testId="new-company-ownership"
          />
        </Field>
      </div>
      <div className="td-dialog-row">
        <Field label="Industry" optional div>
          <Dropdown label="Industry" value={industry} placeholder="Pick an industry" options={[{ value: '', label: 'Not set' }, ...INDUSTRIES.map((i) => ({ value: i, label: i }))]} onChange={setIndustry} width="100%" testId="new-company-industry" />
        </Field>
        <Field label="Contact" optional div>
          <Dropdown label="Contact" value={contact} placeholder="No contact" options={[{ value: '', label: 'No contact' }, { value: NEW_CONTACT, label: '+ New contact' }, ...contacts]} onChange={setContact} width="100%" testId="new-company-contact" />
        </Field>
      </div>
      {contact === NEW_CONTACT && (
        <Field label="Contact's full name" error={contactError}>
          <input className="gs-input" data-testid="new-company-contact-name" autoFocus placeholder="e.g. Marko Petrović" value={contactName} maxLength={200} aria-invalid={!!contactError} onChange={(e) => setContactName(e.target.value)} onKeyDown={onEnter} />
        </Field>
      )}
      {movesFrom && <span className="gs-sub">{`This contact moves from ${movesFrom} to the new company.`}</span>}
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

/** A labelled field with "(optional)" or its error under it. `div` for a dropdown, which is a button of its own. */
function Field({ label, optional, error, div, children }: { label: string; optional?: boolean; error?: string | null; div?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span>
        {label}
        {optional && <span className="gs-sub"> (optional)</span>}
      </span>
      {children}
      {error && (
        <span className="gs-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
  return div ? <div className="gs-label">{body}</div> : <label className="gs-label">{body}</label>;
}
