import { type ReactNode, useState } from 'react';
import { checkEmail, checkPhone } from '../lib/validate';
import { BUYER_ROLES } from '../store/seed';
import { Modal } from '../screens/settings/parts';

/** What the dialog edits; `id` is set when editing an existing contact. */
export interface ContactDraft {
  id?: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  buyerRole: string;
}

/**
 * "New contact at [company]" and "Edit [name]" (CD-534, board C-Company): full name (required),
 * job title, email, phone, and the role in the decision as pills (a second press clears it). A
 * glass sheet portalled to body; Escape, the scrim and × close it without saving.
 */
export function CompanyContactDialog({ companyName, initial, onClose, onSave }: { companyName: string; initial?: ContactDraft; onClose: () => void; onSave: (d: ContactDraft) => Promise<boolean> }) {
  const [d, setD] = useState<ContactDraft>(initial ?? { name: '', role: '', email: '', phone: '', buyerRole: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !!initial?.id;
  const field = (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const email = checkEmail(d.email);
  const phone = checkPhone(d.phone);
  const nameError = tried && !d.name.trim() ? "Enter the contact's name." : null;
  const emailError = tried && !email.ok ? email.error : null;
  const phoneError = tried && !phone.ok ? phone.error : null;
  // An older role the contact still carries stays offered until another is picked.
  const roles = d.buyerRole && !BUYER_ROLES.includes(d.buyerRole) ? [...BUYER_ROLES, d.buyerRole] : BUYER_ROLES;
  const save = async () => {
    setTried(true);
    if (!d.name.trim() || !email.ok || !phone.ok || busy) return;
    setBusy(true);
    const ok = await onSave({ ...d, name: d.name.trim(), role: d.role.trim(), email: email.value, phone: phone.value });
    setBusy(false);
    if (ok) onClose();
  };
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && void save();
  return (
    <Modal
      title={editing ? `Edit ${initial!.name}` : `New contact at ${companyName}`}
      desc={editing ? 'Changes show everywhere this contact appears.' : `They are added to Contacts and linked to ${companyName}.`}
      onClose={onClose}
      testId="company-contact-dialog"
    >
      <Field label="Full name" error={nameError}>
        <input className="gs-input" data-testid="contact-dialog-name" aria-required="true" autoFocus placeholder="e.g. Jovana Ilić" value={d.name} maxLength={200} aria-invalid={!!nameError} onChange={field('name')} onKeyDown={onEnter} />
      </Field>
      <Field label="Job title">
        <input className="gs-input" data-testid="contact-dialog-title" placeholder="e.g. Finance director" value={d.role} maxLength={120} onChange={field('role')} onKeyDown={onEnter} />
      </Field>
      <div className="td-dialog-row">
        <Field label="Email" error={emailError}>
          <input className="gs-input" data-testid="contact-dialog-email" type="email" placeholder="name@company.com" value={d.email} aria-invalid={!!emailError} onChange={field('email')} onKeyDown={onEnter} />
        </Field>
        <Field label="Phone" error={phoneError}>
          <input className="gs-input" data-testid="contact-dialog-phone" type="tel" placeholder="+381" value={d.phone} aria-invalid={!!phoneError} onChange={field('phone')} onKeyDown={onEnter} />
        </Field>
      </div>
      <div className="gs-label">
        Role in the decision
        <span className="gs-move" role="group" aria-label="Role in the decision" data-testid="contact-dialog-roles">
          {roles.map((r) => (
            <button key={r} type="button" className={d.buyerRole === r ? 'on' : ''} aria-pressed={d.buyerRole === r} onClick={() => setD((x) => ({ ...x, buyerRole: x.buyerRole === r ? '' : r }))}>
              {r}
            </button>
          ))}
        </span>
      </div>
      <div className="gs-sheet-actions">
        <button type="button" className="gs-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="gs-btn primary" data-testid="contact-dialog-save" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Add contact'}
        </button>
      </div>
    </Modal>
  );
}

/** A labelled field with its error under it. */
function Field({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="gs-label">
      <span>{label}</span>
      {children}
      {error && (
        <span className="gs-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
