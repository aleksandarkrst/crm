import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CustomFieldRows } from '../components/CustomFields';
import { IconRow } from '../components/icons';
import { MeetingsCard } from '../components/MeetingsCard';
import { Screen } from '../components/Layout';
import { CompanyProjects } from './CompanyProjects';
import { AddButton, DealsSection, FocusTasks, RecordHeader, RecordHistory, Section } from '../components/RecordParts';
import { CheckedInput, GhostInput, GhostSelect, Picker, PickerRow, usePicker } from '../components/ui';
import { mapsSearchUrl } from '../lib/maps';
import { checkActivityCode, checkMb, checkPib } from '../lib/serbianIds';
import { checkDomain } from '../lib/validate';
import { paths } from '../lib/paths';
import { INDUSTRIES, SOURCES, TEAM_SIZES } from '../store/seed';
import { allPeople, companyOfPerson, companyRecords, contactsForLead, curOf, initialsOf, timelineFor } from '../store/selectors';
import { type CompanyFieldKey, useStore } from '../store/store';
import type { Person } from '../store/types';

/** The website of a domain such as "acme.com" (or a full http(s) address); '' when it isn't one. */
function websiteHref(value: string): string {
  const v = value.trim();
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v) ? 'https://' + v : '';
}

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
  // By name (CD-361), the way people look for someone.
  people.sort((a, b) => a.name.localeCompare(b.name));
  const q = picker.search.toLowerCase().trim();
  const directory = allPeople(s)
    .filter((p) => !seen.has(p.contactId || p.id))
    .filter((p) => !q || String(p.name || '').toLowerCase().includes(q));
  const target = rec.leads[0];

  const activities = rec.leads.flatMap((l) => timelineFor(s, l.id)).slice(0, 30);
  const setField = (key: CompanyFieldKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => store.setCompanyField(rec.id, key, e.target.value);
  const domain = extra?.domain ?? '';
  const website = websiteHref(domain);
  const pib = extra?.pib ?? '';
  const map = mapsSearchUrl(rec.name, extra?.address, extra?.city || rec.hq);
  const newDeal = () => set({ newLeadOpen: true, newLeadCompanyId: rec.id, newLeadContactId: null });

  /** Deals keep a company, so a company with deals can't be deleted; its contacts are kept. */
  const onDelete = () => {
    if (rec.leads.length) {
      const what = rec.leads.length === 1 ? 'an opportunity' : rec.leads.length + ' opportunities';
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
          ownerId={extra ? (extra.ownerId ?? null) : rec.ownerId}
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
                <span className="contact-field">
                  <GhostInput aria-label="HQ" value={rec.hq} onChange={setField('hq')} />
                  {(extra?.address || extra?.city || (rec.hq && rec.hq !== '—')) && (
                    <a className="contact-action" href={map} target="_blank" rel="noopener noreferrer" aria-label={`Show ${rec.name} on a map`}>
                      Map
                    </a>
                  )}
                </span>
              </IconRow>
              <IconRow icon="team" label="Team size">
                <GhostSelect chevron aria-label="Team size" value={rec.size} onChange={setField('size')} options={TEAM_SIZES} />
              </IconRow>
              <IconRow icon="source" label="Source">
                <GhostSelect chevron aria-label="Source" value={rec.source} onChange={setField('source')} options={SOURCES} />
              </IconRow>
              <IconRow icon="globe" label="Domain">
                <span className="contact-field">
                  <CheckedInput aria-label="Domain" placeholder="acme.com" value={domain} check={checkDomain} onSave={(v) => store.setCompanyField(rec.id, 'domain', v)} />
                  {website && (
                    <a className="contact-action" href={website} target="_blank" rel="noopener noreferrer" aria-label={`Open ${domain.trim()}`}>
                      Open
                    </a>
                  )}
                </span>
              </IconRow>
              <IconRow icon="note" label="Notes">
                <textarea className="ghost" aria-label="Notes" rows={2} value={extra?.notes ?? ''} onChange={setField('notes')} placeholder="What to know about this company" style={{ resize: 'vertical', lineHeight: 1.5, flex: 1 }} />
              </IconRow>
              <CustomFieldRows entity="company" recordId={rec.id} />
            </Section>

            <Section title="Identity" testId="company-identity" action={<span style={{ fontSize: 12, color: 'var(--text-2)' }}>As registered in APR</span>}>
              <IdentityRow label="Company ID (PIB)" missing={!pib} badge={pib ? undefined : 'No PIB'}>
                <CheckedInput aria-label="Company ID (PIB)" inputMode="numeric" placeholder="9 digits" value={pib} check={checkPib} onSave={(v) => store.setCompanyField(rec.id, 'pib', v)} />
              </IdentityRow>
              <IdentityRow label="Matični broj" missing={!extra?.mb}>
                <CheckedInput aria-label="Matični broj" inputMode="numeric" placeholder="8 digits" value={extra?.mb ?? ''} check={checkMb} onSave={(v) => store.setCompanyField(rec.id, 'mb', v)} />
              </IdentityRow>
              <IdentityRow label="Šifra delatnosti" missing={!extra?.activityCode}>
                <CheckedInput aria-label="Šifra delatnosti" inputMode="numeric" placeholder="4 digits, e.g. 6201" value={extra?.activityCode ?? ''} check={checkActivityCode} onSave={(v) => store.setCompanyField(rec.id, 'activityCode', v)} />
              </IdentityRow>
              <IdentityRow label="Ownership">
                <GhostSelect chevron aria-label="Ownership" value={extra?.ownershipType ?? ''} onChange={setField('ownershipType')} options={[{ value: 'private', label: 'Private' }, { value: 'state', label: 'State' }]} />
              </IdentityRow>
              <IdentityRow label="Street" missing={!extra?.address}>
                <GhostInput aria-label="Street" placeholder="Street and number" value={extra?.address ?? ''} onChange={setField('address')} />
              </IdentityRow>
              <IdentityRow label="City" missing={!extra?.city}>
                <GhostInput aria-label="City" value={extra?.city ?? ''} onChange={setField('city')} />
              </IdentityRow>
              <IdentityRow label="Postal code" missing={!extra?.postalCode}>
                <GhostInput aria-label="Postal code" inputMode="numeric" placeholder="21000" value={extra?.postalCode ?? ''} onChange={setField('postalCode')} />
              </IdentityRow>
            </Section>

            <DealsSection leads={rec.leads} onAdd={newDeal} />

            <CompanyProjects companyId={rec.id} />

            <MeetingsCard record={{ companyId: rec.id }} seed={{ companyId: rec.id }} />

            <Section
              title={`Contacts (${people.length})`}
              testId="company-contacts"
              action={<AddButton label="Add a contact" onClick={() => set({ contactOpen: true, contactDealId: '', contactCompanyId: rec.id })} />}
            >
              {people.map((p) => (
                <button key={p.id} type="button" onClick={() => store.openContact(p.contactId || p.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', flexWrap: 'wrap', padding: '7px 0', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                  <span className="avatar" style={{ width: 28, height: 28, fontSize: 10.5, fontWeight: 600 }}>
                    {p.initials || initialsOf(p.name)}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--brand)' }}>{p.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[p.role, p.buyerRole].filter((x) => x && x !== '—').join(' · ')}</span>
                  </span>
                  {/* A contact without a role in the decision blocks the opportunity (CD-361). */}
                  {!p.buyerRole && (
                    <span className="badge badge-warn" data-testid="no-role-badge" style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
                      No role in decision
                    </span>
                  )}
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
            <RecordHistory entries={activities} entity="company" id={rec.id} cur={curOf(s)} rev={JSON.stringify([rec.name, rec.industry, rec.hq, rec.size, rec.source, extra?.ownerId, extra?.domain, extra?.notes, pib, extra?.mb, extra?.activityCode, extra?.ownershipType, extra?.address, extra?.city, extra?.postalCode])} />
          </div>
        </div>
      </div>
    </Screen>
  );
}

/** A row of the Identity card (CD-357): the label, the field, and "Missing" while it is empty. */
function IdentityRow({ label, missing, badge, children }: { label: string; missing?: boolean; badge?: string; children: React.ReactNode }) {
  return (
    <div className="field-row identity-row">
      <span className="field-label">{label}</span>
      <span className="contact-field">
        {children}
        {missing && <span className="badge badge-warn">{badge ?? 'Missing'}</span>}
      </span>
    </div>
  );
}
