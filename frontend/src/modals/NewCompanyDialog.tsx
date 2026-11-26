import { useState, type ReactNode } from 'react';
import type { ApiOwnership } from '../lib/api';
import { paths } from '../lib/paths';
import { checkActivityCode, mbProblem, pibProblem } from '../lib/serbianIds';
import { checkEmail, checkPhone } from '../lib/validate';
import { Confirm, Dropdown, Modal } from '../screens/settings/parts';
import { BUYER_ROLES, INDUSTRIES } from '../store/seed';
import { allPeople } from '../store/selectors';
import { useStore } from '../store/store';

/** Contact dropdown values: "+ New contact" opens the sheet; the contact added there is picked as NEW_CONTACT. */
const ADD_CONTACT = '__add';
const NEW_CONTACT = '__new';

/**
 * New company (CD-533, board C-Companies). The name, PIB, Matični broj and Šifra delatnosti are
 * required; industry, ownership and a contact are optional. The contact is one already in the
 * workspace (it moves to the new company) or a new one, added in a sheet over this dialog. The company starts as a lead with
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
  const [draft, setDraft] = useState<NewContactDraft | null>(null);
  const [addingContact, setAddingContact] = useState(false);
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
  const taken = cleanPib && !pibProblem(cleanPib) ? s.extraCompanies.find((c) => c.id && c.pib === cleanPib) : undefined;
  const existing = taken ? { id: taken.id!, name: taken.name } : failed?.existingId ? { id: failed.existingId, name: s.extraCompanies.find((c) => c.id === failed.existingId)?.name ?? 'another company' } : null;

  const people = allPeople(s).filter((p) => p.contactId);
  const movesFrom = contact && contact !== NEW_CONTACT ? people.find((p) => p.contactId === contact)?.company : undefined;
  const contacts = [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.contactId!, label: p.company ? `${p.name}, ${p.company}` : p.name }));

  const close = () => set({ newCompanyOpen: false });
  // Escape, the backdrop and × ask before dropping what was typed (CD-490), with the glass confirm
  // over the dialog; Cancel doesn't ask. Escape on the confirm closes only the confirm.
  const [discarding, setDiscarding] = useState(false);
  const dismiss = () => {
    if (![name, pib, mb, activityCode, industry, ownership, contact].some(Boolean) && !draft) close();
    else setDiscarding(true);
  };
  const open = (id: string) => {
    close();
    navigate(paths.company(id));
  };

  const create = async () => {
    setTouched(true);
    setFailed(null);
    const invalid = !name.trim() || !cleanPib || pibProblem(cleanPib) || !cleanMb || mbProblem(cleanMb) || !code || !codeCheck.ok;
    if (busy || invalid || taken) return;
    setBusy(true);
    const picked = contact === NEW_CONTACT ? (draft ?? undefined) : contact ? { id: contact } : undefined;
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
      <Field label="Name" required error={nameError}>
        <input className="gs-input" data-testid="new-company-name" aria-required="true" autoFocus placeholder="Company name" value={name} maxLength={200} aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
      </Field>
      <div className="td-dialog-row">
        <Field label="Company ID (PIB)" required error={pibError}>
          <input className="gs-input" data-testid="new-company-pib" aria-required="true" inputMode="numeric" placeholder="9 digits" value={pib} aria-invalid={!!pibError || !!existing} onChange={(e) => setPib(e.target.value)} onKeyDown={onEnter} />
        </Field>
        <Field label="Matični broj" required error={mbError}>
          <input className="gs-input" data-testid="new-company-mb" aria-required="true" inputMode="numeric" placeholder="8 digits" value={mb} aria-invalid={!!mbError} onChange={(e) => setMb(e.target.value)} onKeyDown={onEnter} />
        </Field>
      </div>
      {existing && (
        <span className="gs-error" role="alert" data-testid="new-company-pib-taken">
          {/* No second full stop after a name that ends with one ("d.o.o.", QA on CD-533). */}
          This PIB belongs to {existing.name}
          {existing.name.endsWith('.') ? '' : '.'}{' '}
          <button type="button" className="cl-link" onClick={() => open(existing.id)}>
            Open it
          </button>
        </span>
      )}
      <div className="td-dialog-row">
        <Field label="Šifra delatnosti" required error={codeError}>
          <input className="gs-input" data-testid="new-company-activity-code" aria-required="true" inputMode="numeric" placeholder="4 digits, e.g. 6201" value={activityCode} aria-invalid={!!codeError} onChange={(e) => setActivityCode(e.target.value)} onKeyDown={onEnter} />
        </Field>
        <Field label="Ownership" div>
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
        <Field label="Industry" div>
          <Dropdown label="Industry" value={industry} placeholder="Pick an industry" options={[{ value: '', label: 'Not set' }, ...INDUSTRIES.map((i) => ({ value: i, label: i }))]} onChange={setIndustry} width="100%" testId="new-company-industry" />
        </Field>
        <Field label="Contact" div>
          <Dropdown
            label="Contact"
            value={contact}
            placeholder="No contact"
            options={[{ value: '', label: 'No contact' }, { value: ADD_CONTACT, label: draft ? 'Edit the new contact' : '+ New contact' }, ...(draft ? [{ value: NEW_CONTACT, label: `${draft.name} (new)` }] : []), ...contacts]}
            onChange={(v) => (v === ADD_CONTACT ? setAddingContact(true) : setContact(v))}
            width="100%"
            testId="new-company-contact"
          />
        </Field>
      </div>
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
      {addingContact && (
        <NewContactSheet
          initial={draft}
          onClose={() => setAddingContact(false)}
          onSave={(d) => {
            setDraft(d);
            setContact(NEW_CONTACT);
            setAddingContact(false);
          }}
        />
      )}
      {discarding && <Confirm title="Discard this company?" text="What you entered here is not saved." confirmLabel="Discard" onConfirm={close} onCancel={() => setDiscarding(false)} testId="new-company-discard" />}
    </Modal>
  );
}

/** A labelled field, a red asterisk when it is required, and its error under it. `div` for a dropdown, which is a button of its own. */
function Field({ label, required, error, div, children }: { label: string; required?: boolean; error?: string | null; div?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span>
        {label}
        {required && (
          <span className="gs-req" aria-hidden="true">
            *
          </span>
        )}
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

/** A contact added with "+ New contact": created with the company. */
interface NewContactDraft {
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  buyerRole: string;
}

/**
 * "+ New contact" in New company: a glass sheet over the dialog (which stays behind it). The full
 * name is required; a job title and a role in the decision make the contact count towards
 * Opportunity. Add keeps the contact in the dialog until the company is created; Escape, Cancel
 * and × close only this sheet.
 */
function NewContactSheet({ initial, onSave, onClose }: { initial: NewContactDraft | null; onSave: (d: NewContactDraft) => void; onClose: () => void }) {
  const [d, setD] = useState<NewContactDraft>(initial ?? { name: '', jobTitle: '', email: '', phone: '', buyerRole: '' });
  const [touched, setTouched] = useState(false);
  const field = (k: keyof NewContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const email = checkEmail(d.email);
  const phone = checkPhone(d.phone);
  const nameError = touched && !d.name.trim() ? "Enter the contact's full name." : null;
  const emailError = touched && !email.ok ? email.error : null;
  const phoneError = touched && !phone.ok ? phone.error : null;
  const save = () => {
    setTouched(true);
    if (!d.name.trim() || !email.ok || !phone.ok) return;
    onSave({ name: d.name.trim(), jobTitle: d.jobTitle.trim(), email: email.value, phone: phone.value, buyerRole: d.buyerRole });
  };
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && save();
  return (
    <Modal title="New contact" desc="They are added to the new company when you create it. A job title and a role in the decision complete the contact check." onClose={onClose} stacked testId="new-company-contact-sheet">
      <Field label="Full name" required error={nameError}>
        <input className="gs-input" data-testid="new-contact-name" aria-required="true" placeholder="e.g. Marko Petrović" value={d.name} maxLength={200} aria-invalid={!!nameError} onChange={field('name')} onKeyDown={onEnter} />
      </Field>
      <div className="td-dialog-row">
        <Field label="Job title">
          <input className="gs-input" data-testid="new-contact-job-title" placeholder="e.g. Marketing Director" value={d.jobTitle} maxLength={120} onChange={field('jobTitle')} onKeyDown={onEnter} />
        </Field>
        <Field label="Role in the decision" div>
          <Dropdown label="Role in the decision" value={d.buyerRole} placeholder="Not set" options={[{ value: '', label: 'Not set' }, ...BUYER_ROLES.map((r) => ({ value: r, label: r }))]} onChange={(buyerRole) => setD((x) => ({ ...x, buyerRole }))} width="100%" testId="new-contact-buyer-role" />
        </Field>
      </div>
      <div className="td-dialog-row">
        <Field label="Email" error={emailError}>
          <input className="gs-input" data-testid="new-contact-email" type="email" placeholder="name@company.com" value={d.email} aria-invalid={!!emailError} onChange={field('email')} onKeyDown={onEnter} />
        </Field>
        <Field label="Phone" error={phoneError}>
          <input className="gs-input" data-testid="new-contact-phone" type="tel" placeholder="+381 …" value={d.phone} aria-invalid={!!phoneError} onChange={field('phone')} onKeyDown={onEnter} />
        </Field>
      </div>
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" data-testid="new-contact-add" onClick={save}>
          {initial ? 'Save contact' : 'Add contact'}
        </button>
      </div>
    </Modal>
  );
}
