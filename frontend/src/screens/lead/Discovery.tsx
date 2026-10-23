import { useRef, useState } from 'react';
import { Popover } from '../../components/Popover';
import { Chevron, FieldRow, GhostSelect, Switch } from '../../components/ui';
import { QUALIFICATION_STEPS } from '../../store/seed';
import { allPeople, isoInZone, memberName } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/**
 * Qualification (CD-362): who backs the deal at the customer, what hurts and how we fix it, what
 * still has to happen, and the Qualified switch. It replaced CHAMP. The discovery notes (date, need,
 * constraint, decision maker, proposal headline) are hidden here but stay on the deal for the proposal.
 */
export function Discovery({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const text = (key: 'pain' | 'painSolution' | 'qualificationOther') => (e: React.ChangeEvent<HTMLTextAreaElement>) => store.patchLead(lead.id, { [key]: e.target.value });

  // The company's contacts; a sponsor from elsewhere (the deal moved company) stays pickable.
  const byContact = new Map<string, string>();
  for (const p of allPeople(s)) {
    const id = p.contactId ?? p.id;
    if (p.name && !byContact.has(id) && (p.companyId === lead.companyId || !lead.companyId || id === lead.sponsorContactId || id === lead.powerSponsorContactId)) byContact.set(id, p.name);
  }
  // A sponsor whose contact was deleted since (or isn't loaded) reads as such, not as its id.
  for (const id of [lead.sponsorContactId, lead.powerSponsorContactId]) if (id && !byContact.has(id)) byContact.set(id, 'Former contact');
  const contactOptions = [{ value: '', label: 'Pick a contact' }, ...[...byContact].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))];
  const qualified = !!lead.qualifiedAt;

  return (
    <div className="card card-pad" data-testid="qualification">
      <span style={{ fontSize: 15, fontWeight: 600 }}>Qualification</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        <FieldRow label="Sponsor">
          <GhostSelect chevron aria-label="Sponsor" value={lead.sponsorContactId} onChange={(e) => store.patchLead(lead.id, { sponsorContactId: e.target.value })} options={contactOptions} />
        </FieldRow>
        <FieldRow label="Power sponsor">
          <GhostSelect chevron aria-label="Power sponsor" value={lead.powerSponsorContactId} onChange={(e) => store.patchLead(lead.id, { powerSponsorContactId: e.target.value })} options={contactOptions} />
        </FieldRow>
        <FieldRow label="Pain">
          <textarea className="ghost" aria-label="Pain" rows={2} maxLength={2000} style={{ resize: 'vertical', lineHeight: 1.5 }} value={lead.pain} onChange={text('pain')} placeholder="What hurts them" />
        </FieldRow>
        <FieldRow label="Solution">
          <textarea className="ghost" aria-label="Solution" rows={2} maxLength={2000} style={{ resize: 'vertical', lineHeight: 1.5 }} value={lead.painSolution} onChange={text('painSolution')} placeholder="How we fix the pain" />
        </FieldRow>
        <FieldRow label="To be qualified">
          <StepsSelect value={lead.qualificationSteps} onChange={(qualificationSteps) => store.patchLead(lead.id, { qualificationSteps })} />
        </FieldRow>
        <FieldRow label="Other">
          <textarea className="ghost" aria-label="Other" rows={2} maxLength={1000} style={{ resize: 'vertical', lineHeight: 1.5 }} value={lead.qualificationOther} onChange={text('qualificationOther')} placeholder="Anything else that must happen" />
        </FieldRow>
        <FieldRow label="Qualified">
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 9px', minWidth: 0 }}>
            <Switch on={qualified} label="Qualified" onClick={() => store.setQualified(lead.id, !qualified)} />
            {qualified && (
              <span data-testid="qualified-by" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                {dayLabel(isoInZone(new Date(lead.qualifiedAt!), s.workspace.timezone))} · {memberName(s, lead.qualifiedBy)}
              </span>
            )}
          </span>
        </FieldRow>
      </div>
    </div>
  );
}

/** "2 Oct 2026" for an ISO date (the day the deal was marked Qualified, in the workspace time zone). */
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The steps still to be done, picked from a fixed list (any number, in the list's order). */
function StepsSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const toggle = (step: string) => onChange(QUALIFICATION_STEPS.filter((x) => (x === step ? !value.includes(x) : value.includes(x))));
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <button
        ref={button}
        type="button"
        className="ghost"
        aria-label="To be qualified"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', color: value.length ? 'var(--ink)' : 'var(--muted)' }}
      >
        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>{value.length ? value.join(', ') : 'Pick what must happen'}</span>
        <Chevron />
      </button>
      {open && (
        <Popover anchor={button} onClose={() => setOpen(false)} className="qual-steps-pop" label="To be qualified" testId="qualification-steps">
          {QUALIFICATION_STEPS.map((step) => (
            <label key={step} className="org-multi-item">
              <input type="checkbox" checked={value.includes(step)} onChange={() => toggle(step)} />
              <span>{step}</span>
            </label>
          ))}
        </Popover>
      )}
    </div>
  );
}
