import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CustomFieldRows } from '../components/CustomFields';
import { DangerButton, FieldRow, GhostInput, GhostSelect, Picker, PickerRow, usePicker } from '../components/ui';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { BUYER_ROLES, CHANNEL_LABELS } from '../store/seed';
import { allPeople, companyOfPerson, initialsOf, leadById, memberName, personById, timelineFor } from '../store/selectors';
import { useStore } from '../store/store';
import type { Person } from '../store/types';
import { docStateClass } from './lead/docs';

export function Contact() {
  const store = useStore();
  const { s, set } = store;
  const { id = '' } = useParams();
  const picker = usePicker();
  // A contact is addressed by its person id or its backend contact id; unknown ids go back to the list.
  const p = personById(s, id) || allPeople(s).find((x) => x.contactId === id);
  const c = p ? leadById(s, p.leadId) : undefined;
  const leadId = c?.id;
  const { ensureLog } = store;
  useEffect(() => {
    if (leadId) ensureLog([leadId]);
  }, [leadId, ensureLog]);
  if (!p) return <Navigate to={paths.contacts} replace />;
  const company = companyOfPerson(s, p);

  const setField = (key: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.patchPerson(p.id, { [key]: e.target.value });
  const q = picker.search.toLowerCase().trim();
  const companyOptions = s.leads.filter((l) => l.id !== p.leadId).filter((l) => !q || l.company.toLowerCase().includes(q));
  const docs = c?.docs || [];

  const onDelete = () => {
    const primaryOf = p.contactId ? s.leads.filter((l) => l.contactId === p.contactId) : [];
    const note = primaryOf.length
      ? ` ${primaryOf.length === 1 ? 'The deal' : primaryOf.length + ' deals'} where they are the primary contact (${primaryOf.map((l) => l.title || l.company).join(', ')}) will be kept without a primary contact.`
      : '';
    if (window.confirm(`Delete ${p.name}? They are removed from every deal.${note} This can't be undone.`)) void store.deleteContact(p.id);
  };

  return (
    <Screen title={p.name || 'Contact'} onTitleChange={(v) => store.patchPerson(p.id, { name: v })} crumb={{ label: 'Contacts', to: paths.contacts }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="avatar" style={{ width: 46, height: 46, fontSize: 15, fontWeight: 600 }}>
                {p.initials || initialsOf(p.name)}
              </div>
              <input className="ghost" value={p.name} onChange={setField('name')} style={{ flex: '1 1 200px', minWidth: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', borderRadius: 8, padding: '5px 8px', marginLeft: -8, width: 'auto' }} />
              {store.canDelete && p.contactId && <DangerButton onClick={onDelete}>Delete contact</DangerButton>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--divider)' }}>
              <FieldRow label="Role">
                <GhostInput value={p.role} onChange={setField('role')} />
              </FieldRow>
              <FieldRow label="Company">
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
              </FieldRow>
              <FieldRow label="Role in the decision">
                <GhostSelect value={p.buyerRole || 'Influencer'} onChange={setField('buyerRole')} options={BUYER_ROLES} />
              </FieldRow>
              <FieldRow label="Email">
                <GhostInput value={p.email} onChange={setField('email')} />
              </FieldRow>
              <FieldRow label="Phone">
                <GhostInput value={p.phone} onChange={setField('phone')} />
              </FieldRow>
              <CustomFieldRows entity="contact" recordId={p.contactId} />
              <FieldRow label="Owner">
                <span className="field-value">{memberName(s, p.ownerId, p.ownerName)}</span>
              </FieldRow>
              <FieldRow label="Last touch">
                <span className="field-value">{!c ? '—' : c.stall === 0 ? 'today' : c.stall === 1 ? '1 day ago' : c.stall + ' days ago'}</span>
              </FieldRow>
            </div>
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Activity with this contact</span>
              <button type="button" className="btn-outline" onClick={() => set({ taskOpen: true, taskLeadId: c?.id ?? '' })}>
                Add task
              </button>
            </div>
            {(c ? timelineFor(s, c.id) : []).map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, paddingTop: 13, borderTop: '1px solid var(--divider)', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 11.5, color: 'var(--muted)', minWidth: 48, paddingTop: 2 }}>{e.date}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{e.detail}</span>
                </div>
                <span className="badge badge-neutral">{CHANNEL_LABELS[e.channel] || e.channel}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="caps-muted">Documents sent</span>
            {docs.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>Nothing sent yet. Documents generated for {company} will appear here.</span>}
            {docs.map((d) => (
              <button key={d.name} type="button" onClick={() => c && store.openDoc(c.id)} style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 9, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                  <span className={'badge ' + docStateClass(d.state)}>{d.state}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{d.meta}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}
