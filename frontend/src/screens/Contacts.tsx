import { useState } from 'react';
import { FilterBar, SortHeader, useSort } from '../components/ui';
import { Screen } from '../components/Layout';
import { BUYER_ROLES } from '../store/seed';
import { allPeople, companyIdOfPerson, companyLabels, companyOfPerson, companyRecords, leadById, ownerOf, salesPeople } from '../store/selectors';
import { useStore } from '../store/store';

const COLS = '1.2fr 1fr 1.2fr 1.4fr 1fr 1.1fr 1fr';
type Key = 'contact' | 'role' | 'company' | 'email' | 'phone' | 'decisionMaker' | 'owner';
const HEADERS: { key: Key; label: string }[] = [
  { key: 'contact', label: 'Contact' },
  { key: 'role', label: 'Role' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'decisionMaker', label: 'Buyer role' },
  { key: 'owner', label: 'Owner' },
];
export const isSenior = (role: string) => /decision maker|economic buyer/i.test(role);

export function Contacts() {
  const { s, set, openContact } = useStore();
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('Company');
  const [owner, setOwner] = useState('Salesperson');
  const [buyerRole, setBuyerRole] = useState('Buyer role');
  const { sort, toggle } = useSort<Key>('contact');

  const q = query.toLowerCase().trim();
  const rows = allPeople(s)
    .map((p) => {
      const l = leadById(s, p.leadId);
      return { id: p.id, contact: p.name, role: p.role, company: companyOfPerson(s, p), companyId: companyIdOfPerson(s, p), email: p.email, phone: p.phone, decisionMaker: p.buyerRole || 'Influencer', owner: l ? ownerOf(l) : '—' };
    })
    .filter((r) => !q || [r.contact, r.company, r.role, r.email].some((v) => String(v).toLowerCase().includes(q)))
    .filter((r) => company === 'Company' || r.companyId === company)
    .filter((r) => owner === 'Salesperson' || r.owner === owner)
    .filter((r) => buyerRole === 'Buyer role' || r.decisionMaker === buyerRole)
    .sort((a, b) => String(a[sort.key]).localeCompare(String(b[sort.key])) * sort.dir);

  return (
    <Screen title="Contacts">
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: 'Search contacts' }}
        chips={[
          { value: company, options: ['Company', ...[...companyLabels(companyRecords(s))].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))], onChange: setCompany },
          { value: owner, options: ['Salesperson', ...salesPeople(s)], onChange: setOwner },
          { value: buyerRole, options: ['Buyer role', ...BUYER_ROLES], onChange: setBuyerRole },
        ]}
        dirty={company !== 'Company' || owner !== 'Salesperson' || buyerRole !== 'Buyer role'}
        onClear={() => {
          setCompany('Company');
          setOwner('Salesperson');
          setBuyerRole('Buyer role');
          setQuery('');
        }}
        action={{ label: 'New contact', onClick: () => set({ contactOpen: true }) }}
      />
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1140 }}>
          <div className="table-head" style={{ gridTemplateColumns: COLS }}>
            {HEADERS.map((h) => (
              <SortHeader key={h.key} label={h.label} active={sort.key === h.key} dir={sort.dir} onClick={() => toggle(h.key)} />
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.id} className="table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => openContact(r.id)}>
              <span style={{ fontWeight: 600 }}>{r.contact}</span>
              <span style={{ color: 'var(--text-2)' }}>{r.role}</span>
              <span>{r.company}</span>
              <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
              <span style={{ color: 'var(--text-2)' }}>{r.phone}</span>
              <span className={isSenior(r.decisionMaker) ? 'badge badge-brand' : 'badge badge-neutral'} style={{ justifySelf: 'start' }}>
                {r.decisionMaker}
              </span>
              <span style={{ color: 'var(--text-2)' }}>{r.owner}</span>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
