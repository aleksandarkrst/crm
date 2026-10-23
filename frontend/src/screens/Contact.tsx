import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CustomFieldRows } from '../components/CustomFields';
import { IconRow } from '../components/icons';
import { MeetingsCard } from '../components/MeetingsCard';
import { Screen } from '../components/Layout';
import { DealsSection, FocusTasks, RecordHeader, RecordHistory, Section } from '../components/RecordParts';
import { CheckedInput, GhostDate, GhostInput, GhostSelect, Picker, PickerRow, usePicker } from '../components/ui';
import { checkEmail, checkLinkedin, checkPhone } from '../lib/validate';
import { paths } from '../lib/paths';
import { BUYER_ROLES, SOURCES } from '../store/seed';
import { allPeople, companyIdOfPerson, companyOfPerson, companyRecords, contactsForLead, curOf, initialsOf, leadById, personById, timelineFor } from '../store/selectors';
import { useStore } from '../store/store';
import type { Person } from '../store/types';
import { docState, docStateClass } from './lead/docs';

/** A LinkedIn value that is a web address (with or without https://); '' otherwise. */
function linkedinHref(value: string): string {
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return /^([a-z]{2,3}\.|www\.)?linkedin\.com\/\S+$/i.test(v) ? 'https://' + v : '';
}

/** A contact (CD-80): header like a deal's, how to reach them, their company, deals, tasks and history. */
/** The Source list companies and opportunities use (CD-361), plus a saved value that isn't on it. */
const sourceOptions = (current?: string) => [{ value: '', label: 'No source' }, ...[...SOURCES, ...(current && !SOURCES.includes(current) ? [current] : [])].map((v) => ({ value: v, label: v }))];

export function Contact() {
  const store = useStore();
  const { s, set } = store;
  const { id = '' } = useParams();
  const picker = usePicker();
  // A contact is addressed by its person id or its backend contact id; unknown ids go back to the list.
  const p = personById(s, id) || allPeople(s).find((x) => x.contactId === id);
  const c = p ? leadById(s, p.leadId) : undefined;
  const deals = p ? s.leads.filter((l) => l.id === p.leadId || contactsForLead(s, l.id).some((x) => (p.contactId ? x.contactId === p.contactId : x.id === p.id))) : [];
  const dealIds = deals.map((l) => l.id).join(',');
  const leadId = c?.id;
  const { ensureLog, ensureDocs } = store;
  useEffect(() => {
    if (dealIds) ensureLog(dealIds.split(','));
    if (leadId) ensureDocs(leadId);
  }, [dealIds, leadId, ensureLog, ensureDocs]);
  if (!p) return <Navigate to={paths.contacts} replace />;
  // Old links by person id ("<deal>:p", "%3Ap" in the address bar) go to the contact's own id (CD-224).
  if (p.contactId && p.contactId !== id) return <Navigate to={paths.contact(p.contactId)} replace />;
  const company = companyOfPerson(s, p);
  const companyRec = companyRecords(s).find((r) => r.id === (p.companyId ?? c?.companyId));

  // Tap to email or call (CD-70); "—" stands for a missing value.
  const mailto = p.email.trim() && checkEmail(p.email).ok ? `mailto:${p.email.trim()}` : '';
  // Only a valid number becomes a Call link (CD-464): "abc123!!" never turns into tel:123.
  const tel = p.phone.trim() && checkPhone(p.phone).ok ? `tel:${p.phone.replace(/\s*(?:ext\.?|x)\s*\d+$/i, '').replace(/[^\d+]/g, '')}` : '';
  const linkedin = linkedinHref(p.linkedin ?? '');
  const setField = (key: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => store.patchPerson(p.id, { [key]: e.target.value });
  const q = picker.search.toLowerCase().trim();
  // Every company, deals or not (CD-464).
  const currentCompanyId = companyIdOfPerson(s, p);
  const companyOptions = companyRecords(s).filter((r) => r.id !== currentCompanyId).filter((r) => !q || r.name.toLowerCase().includes(q));
  const docs = (leadId && s.dealDocs[leadId]) || [];
  const activities = deals.flatMap((l) => timelineFor(s, l.id)).slice(0, 30);
  const newDeal = () => set({ newLeadOpen: true, newLeadCompanyId: companyRec?.id ?? null, newLeadContactId: p.contactId ?? null });

  const onDelete = () => {
    const primaryOf = p.contactId ? s.leads.filter((l) => l.contactId === p.contactId) : [];
    const note = primaryOf.length
      ? ` ${primaryOf.length === 1 ? 'The opportunity' : primaryOf.length + ' opportunities'} where they are the primary contact (${primaryOf.map((l) => l.title || l.company).join(', ')}) will be kept without a primary contact.`
      : '';
    if (window.confirm(`Delete ${p.name}? They are removed from every opportunity.${note} This can't be undone.`)) void store.deleteContact(p.id);
  };

  return (
    <Screen title="Contact" parent={{ label: 'Contacts', to: paths.contacts }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <RecordHeader
          kind="contact"
          initials={p.initials || initialsOf(p.name)}
          name={p.name}
          onName={(v) => store.patchPerson(p.id, { name: v })}
          ownerId={p.ownerId}
          ownerName={p.ownerName}
          onOwner={p.contactId ? (ownerId) => store.patchPerson(p.id, { ownerId }) : undefined}
          onNewDeal={newDeal}
          onDelete={store.canDelete && p.contactId ? onDelete : undefined}
          deleteLabel="Delete contact"
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div className="lead-side" style={{ flex: '1 1 400px', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Section title="Summary" testId="contact-summary">
              <IconRow icon="mail" label="Email">
                <span className="contact-field">
                  <CheckedInput aria-label="Email" type="email" placeholder="name@company.com" value={p.email} check={checkEmail} onSave={(v) => store.patchPerson(p.id, { email: v })} />
                  {mailto && (
                    <a className="contact-action" href={mailto} aria-label={`Email ${p.name}`}>
                      Email
                    </a>
                  )}
                </span>
              </IconRow>
              <IconRow icon="phone" label="Phone">
                <span className="contact-field">
                  <CheckedInput aria-label="Phone" type="tel" placeholder="+381 60 123 4567" value={p.phone} check={checkPhone} onSave={(v) => store.patchPerson(p.id, { phone: v })} />
                  {tel && (
                    <a className="contact-action" href={tel} aria-label={`Call ${p.name}`}>
                      Call
                    </a>
                  )}
                </span>
              </IconRow>
              <IconRow icon="linkedin" label="LinkedIn">
                <span className="contact-field">
                  <CheckedInput aria-label="LinkedIn" placeholder="linkedin.com/in/name" value={p.linkedin ?? ''} check={checkLinkedin} onSave={(v) => store.patchPerson(p.id, { linkedin: v })} />
                  {linkedin && (
                    <a className="contact-action" href={linkedin} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name} on LinkedIn`}>
                      Open
                    </a>
                  )}
                </span>
              </IconRow>
              <IconRow icon="company" label="Company">
                <Picker
                  picker={picker}
                  items={companyOptions.map((r) => (
                    <PickerRow
                      key={r.id}
                      square
                      initials={initialsOf(r.name)}
                      title={r.name}
                      onPick={() => {
                        store.setPersonCompany(p.id, r.id);
                        picker.close();
                      }}
                    />
                  ))}
                >
                  <span>{company}</span>
                </Picker>
              </IconRow>
            </Section>

            <Section title="Details" testId="contact-details">
              <IconRow icon="industry" label="Role">
                <GhostInput aria-label="Role" placeholder="Job title" value={p.role} onChange={setField('role')} />
              </IconRow>
              <IconRow icon="team" label="Role in the decision">
                <GhostSelect chevron aria-label="Role in the decision" value={p.buyerRole ?? ''} onChange={setField('buyerRole')} options={[{ value: '', label: 'No role yet' }, ...BUYER_ROLES.map((b) => ({ value: b, label: b }))]} />
              </IconRow>
              <IconRow icon="company" label="Org unit">
                <GhostInput aria-label="Org unit" placeholder="e.g. Procurement" maxLength={120} value={p.orgUnit ?? ''} onChange={setField('orgUnit')} />
              </IconRow>
              <IconRow icon="source" label="Source">
                <GhostSelect chevron aria-label="Source" value={p.source ?? ''} onChange={setField('source')} options={sourceOptions(p.source)} />
              </IconRow>
              <IconRow icon="note" label="Influence on the opportunity">
                <textarea className="ghost" aria-label="Influence on the opportunity" rows={2} maxLength={2000} value={p.influence ?? ''} onChange={setField('influence')} placeholder="How they influence the opportunity" style={{ resize: 'vertical', lineHeight: 1.5, flex: 1 }} />
              </IconRow>
              <IconRow icon="note" label="Notes">
                <textarea className="ghost" aria-label="Notes" rows={2} value={p.notes ?? ''} onChange={setField('notes')} placeholder="Anything worth knowing" style={{ resize: 'vertical', lineHeight: 1.5, flex: 1 }} />
              </IconRow>
              <IconRow icon="calendar" label="Last touch">
                <span className="field-value">{!c ? '—' : c.stall === 0 ? 'Last touch today' : c.stall === 1 ? 'Last touch 1 day ago' : `Last touch ${c.stall} days ago`}</span>
              </IconRow>
              <CustomFieldRows entity="contact" recordId={p.contactId} />
            </Section>

            {/* Personal (CD-361): for getting to know them; every CRM user sees it. */}
            <Section title="Personal" testId="contact-personal">
              <IconRow icon="calendar" label="Birthday">
                <GhostDate aria-label="Birthday" placeholder="Add birthday" value={p.birthday ?? ''} onChange={setField('birthday')} />
              </IconRow>
              <IconRow icon="team" label="Spouse">
                <GhostInput aria-label="Spouse" placeholder="Add spouse" maxLength={200} value={p.spouseName ?? ''} onChange={setField('spouseName')} />
              </IconRow>
              <IconRow icon="team" label="Children">
                <GhostInput aria-label="Children" placeholder="Add children" maxLength={500} value={p.children ?? ''} onChange={setField('children')} />
              </IconRow>
              <IconRow icon="note" label="Pets">
                <GhostInput aria-label="Pets" placeholder="Add pets" maxLength={500} value={p.pets ?? ''} onChange={setField('pets')} />
              </IconRow>
            </Section>

            {companyRec && (
              <Section title="Company" testId="contact-company">
                <Link to={paths.company(companyRec.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                  <span className="avatar" style={{ width: 30, height: 30, borderRadius: 8, fontSize: 11 }}>
                    {initialsOf(companyRec.name)}
                  </span>
                  {companyRec.name}
                </Link>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13, marginTop: 8 }}>
                  <span style={{ color: 'var(--text-2)' }}>Industry</span>
                  <span>{companyRec.industry || '—'}</span>
                  <span style={{ color: 'var(--text-2)' }}>HQ</span>
                  <span>{companyRec.hq || '—'}</span>
                  <span style={{ color: 'var(--text-2)' }}>Team size</span>
                  <span>{companyRec.size || '—'}</span>
                </div>
              </Section>
            )}

            <DealsSection leads={deals} onAdd={newDeal} />

            {p.contactId && <MeetingsCard record={{ contactId: p.contactId }} seed={{ contactId: p.contactId, companyId: companyRec?.id ?? null }} />}

            <Section title="Documents">
              {docs.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>Nothing generated yet. Documents generated for {company} will appear here.</span>}
              {docs.map((d) => (
                <button key={d.id} type="button" disabled={d.status !== 'ready'} title={d.status === 'ready' ? 'Download .docx' : undefined} onClick={() => void store.downloadDoc(d)} style={{ textAlign: 'left', cursor: d.status === 'ready' ? 'pointer' : 'default', border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 9, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                    <span className={'badge ' + docStateClass(docState(d))}>{docState(d)}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {d.templateName} · {d.createdByName || 'someone who left'}
                  </span>
                </button>
              ))}
            </Section>
          </div>

          <div className="lead-main" style={{ flex: '999 1 480px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <FocusTasks leadIds={deals.map((l) => l.id)} />
            <RecordHistory entries={activities} entity="contact" id={p.contactId} cur={curOf(s)} rev={JSON.stringify(p)} />
          </div>
        </div>
      </div>
    </Screen>
  );
}
