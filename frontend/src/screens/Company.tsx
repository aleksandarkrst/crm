import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CustomFieldRows } from '../components/CustomFields';
import { IconRow } from '../components/icons';
import { Screen } from '../components/Layout';
import { AddButton, DealsSection, FocusTasks, RecordHeader, RecordHistory, Section } from '../components/RecordParts';
import { GhostInput, GhostSelect, Picker, PickerRow, usePicker } from '../components/ui';
import { paths } from '../lib/paths';
import { INDUSTRIES, SOURCES, TEAM_SIZES } from '../store/seed';
import { allPeople, companyOfPerson, companyRecords, contactsForLead, curOf, initialsOf, timelineFor } from '../store/selectors';
import { useStore } from '../store/store';
import type { Person } from '../store/types';

/** A company (CD-80): header like a deal's, its details, deals and contacts, open tasks and history. */
export function Company() {
  const store = useStore();
  const { s, set } = store;
  const { id = '' } = useParams();
  const picker = usePicker();
  const rec = companyRecords(s).find((c) => c.id === id);
  const leadIds = (rec?.leads ?? []).map((l) => l.id).join(',');
  const { ensureLog } = store;
  useEffect(() => {
    if (leadIds) ensureLog(leadIds.split(','));
  }, [leadIds, ensureLog]);
  if (!rec) return <Navigate to={paths.companies} replace />;
  const extra = s.extraCompanies.find((c) => c.id === rec.id);

  // Its own contacts and everyone on its deals.
  const people: Person[] = [];
  const seen = new Set<string>();
  const add = (p: Person) => {
    const key = p.contactId || p.id;
    if (seen.has(key)) return;
    seen.add(key);
    people.push(p);
  };
  allPeople(s)
    .filter((p) => p.companyId === rec.id)
    .forEach(add);
  rec.leads.forEach((l) => contactsForLead(s, l.id).forEach(add));
  const q = picker.search.toLowerCase().trim();
  const directory = allPeople(s)
    .filter((p) => !seen.has(p.contactId || p.id))
    .filter((p) => !q || String(p.name || '').toLowerCase().includes(q));
  const target = rec.leads[0];

  const activities = rec.leads.flatMap((l) => timelineFor(s, l.id)).slice(0, 30);
  const setField = (key: 'name' | 'industry' | 'hq' | 'size' | 'source') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.setCompanyField(rec.id, key, e.target.value);
  const newDeal = () => set({ newLeadOpen: true, newLeadCompanyId: rec.id, newLeadContactId: null });

  /** Deals keep a company, so a company with deals can't be deleted; its contacts are kept. */
  const onDelete = () => {
    if (rec.leads.length) {
      const what = rec.leads.length === 1 ? 'a deal' : rec.leads.length + ' deals';
      window.alert(`${rec.name} has ${what}. Delete them or move them to another company first.`);
      return;
    }
    const own = allPeople(s).filter((p) => p.companyId === rec.id).length;
    const kept = own ? ` Its ${own === 1 ? 'contact is' : own + ' contacts are'} kept without a company.` : '';
    if (window.confirm(`Delete ${rec.name}?${kept} This can't be undone.`)) void store.deleteCompany(rec.id);
  };

  return (
    <Screen title="Company" parent={{ label: 'Companies', to: paths.companies }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <RecordHeader
          kind="company"
          initials={initialsOf(rec.name)}
          name={rec.name}
          onName={(v) => store.setCompanyField(rec.id, 'name', v)}
          ownerId={extra?.ownerId ?? rec.ownerId}
          ownerName={extra?.owner}
          onOwner={(ownerId) => store.setCompanyOwner(rec.id, ownerId)}
          onNewDeal={newDeal}
          onDelete={store.canDelete ? onDelete : undefined}
          deleteLabel="Delete company"
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div className="lead-side" style={{ flex: '1 1 400px', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Section title="Summary" testId="company-summary">
              <IconRow icon="industry" label="Industry">
                <GhostSelect chevron aria-label="Industry" value={rec.industry} onChange={setField('industry')} options={INDUSTRIES} />
              </IconRow>
              <IconRow icon="location" label="HQ">
                <GhostInput aria-label="HQ" value={rec.hq} onChange={setField('hq')} />
              </IconRow>
              <IconRow icon="team" label="Team size">
                <GhostSelect chevron aria-label="Team size" value={rec.size} onChange={setField('size')} options={TEAM_SIZES} />
              </IconRow>
              <IconRow icon="source" label="Source">
                <GhostSelect chevron aria-label="Source" value={rec.source} onChange={setField('source')} options={SOURCES} />
              </IconRow>
              <CustomFieldRows entity="company" recordId={rec.id} />
            </Section>

            <DealsSection leads={rec.leads} onAdd={newDeal} />

            <Section
              title={`Contacts (${people.length})`}
              testId="company-contacts"
              action={<AddButton label="Add a contact" onClick={() => set(target ? { contactOpen: true, contactCompany: target.id } : { contactOpen: true })} />}
            >
              {people.map((p) => (
                <button key={p.id} type="button" onClick={() => store.openContact(p.contactId || p.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                  <span className="avatar" style={{ width: 28, height: 28, fontSize: 10.5, fontWeight: 600 }}>
                    {p.initials || initialsOf(p.name)}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--brand)' }}>{p.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[p.role, p.buyerRole].filter((x) => x && x !== '—').join(' · ')}</span>
                  </span>
                </button>
              ))}
              {people.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>No contacts yet.</span>}
              {target && (
                <Picker
                  picker={picker}
                  placeholder="Link an existing contact…"
                  items={directory.map((p) => (
                    <PickerRow
                      key={p.id}
                      initials={p.initials || initialsOf(p.name)}
                      title={p.name}
                      subtitle={companyOfPerson(s, p)}
                      onPick={() => {
                        store.linkPerson(target.id, p.id);
                        picker.setSearch('');
                      }}
                    />
                  ))}
                />
              )}
            </Section>
          </div>

          <div className="lead-main" style={{ flex: '999 1 480px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <FocusTasks leadIds={rec.leads.map((l) => l.id)} />
            <RecordHistory entries={activities} entity="company" id={rec.id} cur={curOf(s)} rev={JSON.stringify([rec.name, rec.industry, rec.hq, rec.size, rec.source, extra?.ownerId])} />
          </div>
        </div>
      </div>
    </Screen>
  );
}
