import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CustomFieldRows } from '../components/CustomFields';
import { IconRow } from '../components/icons';
import { MeetingsCard } from '../components/MeetingsCard';
import { Screen } from '../components/Layout';
import { DealsSection, FocusTasks, RecordHeader, RecordHistory, Section } from '../components/RecordParts';
import { CheckedInput, GhostInput, GhostSelect, Picker, PickerRow, usePicker } from '../components/ui';
import { checkLinkedin } from '../lib/validate';
import { paths } from '../lib/paths';
import { BUYER_ROLES } from '../store/seed';
import { allPeople, companyOfPerson, companyRecords, contactsForLead, curOf, initialsOf, leadById, personById, timelineFor } from '../store/selectors';
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
  const mailto = /^[^\s@]+@[^\s@]+$/.test(p.email.trim()) ? `mailto:${p.email.trim()}` : '';
  const tel = /\d/.test(p.phone) ? `tel:${p.phone.replace(/[^\d+]/g, '')}` : '';
  const linkedin = linkedinHref(p.linkedin ?? '');
  const setField = (key: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => store.patchPerson(p.id, { [key]: e.target.value });
  const q = picker.search.toLowerCase().trim();
  const companyOptions = s.leads.filter((l) => l.id !== p.leadId).filter((l) => !q || l.company.toLowerCase().includes(q));
  const docs = (leadId && s.dealDocs[leadId]) || [];
  const activities = deals.flatMap((l) => timelineFor(s, l.id)).slice(0, 30);
  const newDeal = () => set({ newLeadOpen: true, newLeadCompanyId: companyRec?.id ?? null, newLeadContactId: p.contactId ?? null });

  const onDelete = () => {
    const primaryOf = p.contactId ? s.leads.filter((l) => l.contactId === p.contactId) : [];
    const note = primaryOf.length
      ? ` ${primaryOf.length === 1 ? 'The deal' : primaryOf.length + ' deals'} where they are the primary contact (${primaryOf.map((l) => l.title || l.company).join(', ')}) will be kept without a primary contact.`
      : '';
    if (window.confirm(`Delete ${p.name}? They are removed from every deal.${note} This can't be undone.`)) void store.deleteContact(p.id);
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
                  <GhostInput aria-label="Email" value={p.email} onChange={setField('email')} />
                  {mailto && (
                    <a className="contact-action" href={mailto} aria-label={`Email ${p.name}`}>
                      Email
                    </a>
                  )}
                </span>
              </IconRow>
              <IconRow icon="phone" label="Phone">
                <span className="contact-field">
                  <GhostInput aria-label="Phone" value={p.phone} onChange={setField('phone')} />
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
                  items={companyOptions.map((l) => (
                    <PickerRow
                      key={l.id}
                      square
                      initials={initialsOf(l.company)}
                      title={l.company}
                      subtitle={l.title && l.title !== l.company ? l.title : undefined}
                      onPick={() => {
                        store.movePerson(p.id, l.id);
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
                <GhostSelect chevron aria-label="Role in the decision" value={p.buyerRole || 'Influencer'} onChange={setField('buyerRole')} options={BUYER_ROLES} />
              </IconRow>
              <IconRow icon="note" label="Notes">
                <textarea className="ghost" aria-label="Notes" rows={2} value={p.notes ?? ''} onChange={setField('notes')} placeholder="How they influence the deal" style={{ resize: 'vertical', lineHeight: 1.5, flex: 1 }} />
              </IconRow>
              <IconRow icon="calendar" label="Last touch">
                <span className="field-value">{!c ? '—' : c.stall === 0 ? 'Last touch today' : c.stall === 1 ? 'Last touch 1 day ago' : `Last touch ${c.stall} days ago`}</span>
              </IconRow>
              <CustomFieldRows entity="contact" recordId={p.contactId} />
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
