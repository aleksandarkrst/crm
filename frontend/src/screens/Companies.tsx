import { useState } from 'react';
import { FilterBar, SortHeader, useSort } from '../components/ui';
import { Screen } from '../components/Layout';
import { INDUSTRIES } from '../store/seed';
import { type CompanyRecord, companyRecords, salesPeople } from '../store/selectors';
import { useStore } from '../store/store';

const COLS = '1.5fr 1.1fr 1fr 0.9fr 0.7fr 0.8fr 1fr 1.1fr 1.1fr 0.8fr 1fr';
type Key = 'name' | 'industry' | 'hq' | 'size' | 'contactCount' | 'oppCount' | 'value' | 'stageName' | 'owner' | 'lastTouch' | 'source';
const HEADERS: { key: Key; label: string }[] = [
  { key: 'name', label: 'Company' },
  { key: 'industry', label: 'Industry' },
  { key: 'hq', label: 'HQ' },
  { key: 'size', label: 'Team size' },
  { key: 'contactCount', label: 'Contacts' },
  { key: 'oppCount', label: 'Opportunities' },
  { key: 'value', label: 'Open value' },
  { key: 'stageName', label: 'Latest stage' },
  { key: 'owner', label: 'Owner' },
  { key: 'lastTouch', label: 'Last touch' },
  { key: 'source', label: 'Source' },
];
const NUMERIC = new Set<Key>(['value', 'oppCount', 'contactCount']);

export function Companies() {
  const { s, addCompany, openCompany } = useStore();
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('Industry');
  const [owner, setOwner] = useState('Owner');
  const { sort, toggle } = useSort<Key>('name');

  const q = query.toLowerCase().trim();
  const sortVal = (c: CompanyRecord) => (NUMERIC.has(sort.key) ? (c[sort.key] as number) : String(c[sort.key] || '').toLowerCase());
  const rows = companyRecords(s)
    .filter((c) => !q || c.name.toLowerCase().includes(q) || String(c.industry || '').toLowerCase().includes(q) || String(c.hq || '').toLowerCase().includes(q))
    .filter((c) => industry === 'Industry' || c.industry === industry)
    .filter((c) => owner === 'Owner' || c.owner === owner)
    .sort((a, b) => {
      const av = sortVal(a);
      const bv = sortVal(b);
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });

  return (
    <Screen title="Companies">
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: 'Search companies' }}
        chips={[
          { value: industry, options: ['Industry', ...INDUSTRIES], onChange: setIndustry },
          { value: owner, options: ['Owner', ...salesPeople(s)], onChange: setOwner },
        ]}
        dirty={industry !== 'Industry' || owner !== 'Owner'}
        onClear={() => {
          setIndustry('Industry');
          setOwner('Owner');
          setQuery('');
        }}
        meta={rows.length + (rows.length === 1 ? ' company' : ' companies')}
        action={{ label: 'Add company', onClick: addCompany }}
      />
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1180 }}>
          <div className="table-head" style={{ gridTemplateColumns: COLS }}>
            {HEADERS.map((h) => (
              <SortHeader key={h.key} label={h.label} active={sort.key === h.key} dir={sort.dir} onClick={() => toggle(h.key)} />
            ))}
          </div>
          {rows.map((c) => (
            <div key={c.id} className="table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => openCompany(c.id)}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: 'var(--text-2)' }}>{c.industry}</span>
              <span style={{ color: 'var(--text-2)' }}>{c.hq}</span>
              <span style={{ color: 'var(--text-2)' }}>{c.size}</span>
              <span style={{ color: 'var(--text-2)' }}>{c.contactCount}</span>
              <span style={{ color: 'var(--text-2)' }}>{c.oppCount}</span>
              <span style={{ color: 'var(--brand)' }}>{c.valueLabel}</span>
              <span style={{ fontSize: 12.5 }}>{c.stageName}</span>
              <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.owner}</span>
              <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.lastTouch}</span>
              <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.source}</span>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
