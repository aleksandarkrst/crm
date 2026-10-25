import { useMemo } from 'react';
import { FilterBar, SortHeader, useSort } from '../components/ui';
import { DataActions } from '../components/DataActions';
import { EmptyState } from '../components/EmptyState';
import { FilterEmpty, FilterRow } from '../components/FilterRow';
import { Screen } from '../components/Layout';
import { contactsCsv } from '../store/exportCsv';
import { contactPageFields, filterPeople, NO_ROLE } from '../store/filterFields';
import { applyFilters, clearAll } from '../store/filters';
import { allPeople, companyIdOfPerson, companyOfPerson, memberName, todayIso } from '../store/selectors';
import { useStore } from '../store/store';
import { usePageFilters } from '../store/usePageFilters';

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
  const { s, set, openContact, session } = useStore();
  const fields = useMemo(() => contactPageFields(s), [s]);
  const [filters, setFilters] = usePageFilters('contacts', { order: ['owner'], f: { owner: { vals: [] } } });
  const { sort, toggle } = useSort<Key>('contact');

  const rows = applyFilters(allPeople(s), fields, filters, { today: todayIso(s.workspace.timezone), fiscalMonth: s.workspace.fiscalMonth })
    // The contact's own owner (from the contacts API), not the owner of a deal they are on.
    .map((p) => ({ id: p.id, contact: p.name, role: p.role, company: companyOfPerson(s, p), companyId: companyIdOfPerson(s, p), email: p.email, phone: p.phone, decisionMaker: p.buyerRole || NO_ROLE, owner: memberName(s, p.ownerId, p.ownerName), ownerId: p.ownerId ?? null }))
    .sort((a, b) => String(a[sort.key]).localeCompare(String(b[sort.key])) * sort.dir);

  return (
    <Screen title="Contacts">
      <FilterBar
        row={<FilterRow fields={fields} value={filters} onChange={setFilters} people={filterPeople(s, session.userId)} me={session.userId} />}
        extra={<DataActions type="contacts" count={rows.length} exportCsv={() => contactsCsv(s, rows)} />}
        action={{ label: 'New contact', onClick: () => set({ contactOpen: true }) }}
      />
      {allPeople(s).length === 0 ? (
        <EmptyState title="No contacts yet" text="Contacts are the people you talk to at your companies: who decides, who pays, who champions you." action={{ label: 'New contact', onClick: () => set({ contactOpen: true }) }} />
      ) : rows.length === 0 ? (
        <FilterEmpty noun="contacts" onClear={() => setFilters(clearAll(fields))} />
      ) : (
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
                <span className={r.decisionMaker === NO_ROLE ? 'badge badge-warn' : isSenior(r.decisionMaker) ? 'badge badge-brand' : 'badge badge-neutral'} style={{ justifySelf: 'start' }}>
                  {r.decisionMaker}
                </span>
                <span style={{ color: 'var(--text-2)' }}>{r.owner}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Screen>
  );
}
