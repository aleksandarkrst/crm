import { useState } from 'react';
import { FilterBar, GhostInput, GhostSelect, RemoveButton } from '../components/ui';
import { Screen } from '../components/Layout';
import { BILLING_KINDS, currencyOptions, PRODUCT_TYPES } from '../store/seed';
import { itemCurrency, linesOf } from '../store/selectors';
import { useStore } from '../store/store';

const COLS = 'minmax(0,1.8fr) 1fr 1.1fr 1fr 0.9fr 0.7fr 1fr 40px';

export function Products() {
  const { s, set, flash, patchProduct, removeProduct } = useStore();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('Type');
  const [kind, setKind] = useState('Billing');

  const usage: Record<string, string[]> = {};
  s.leads.forEach((l) => linesOf(s, l).forEach((ln) => (usage[ln.itemId] ||= []).push(l.id)));
  const q = query.toLowerCase().trim();
  const rows = s.catalog
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .filter((c) => type === 'Type' || c.type === type)
    .filter((c) => kind === 'Billing' || c.kind === kind);

  const patch = (id: string, key: 'name' | 'type' | 'kind' | 'price' | 'vat' | 'currency') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => patchProduct(id, key, e.target.value);

  return (
    <Screen title="Products & services">
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: 'Search catalog' }}
        chips={[
          { value: type, options: ['Type', ...PRODUCT_TYPES], onChange: setType },
          { value: kind, options: ['Billing', ...BILLING_KINDS], onChange: setKind },
        ]}
        dirty={type !== 'Type' || kind !== 'Billing'}
        onClear={() => {
          setType('Type');
          setKind('Billing');
          setQuery('');
        }}
        action={{ label: 'New product', onClick: () => set({ productOpen: true }) }}
      />
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1020 }}>
          <div className="table-head" style={{ gridTemplateColumns: COLS }}>
            {['Name', 'Type', 'Billing', 'Unit price', 'Currency', 'VAT %', 'On deals', ''].map((h, i) => (
              <span key={i} className="th">
                {h}
              </span>
            ))}
          </div>
          {rows.map((c) => {
            const used = usage[c.id] || [];
            return (
              <div key={c.id} className="table-row" style={{ gridTemplateColumns: COLS, padding: '9px 16px' }}>
                <GhostInput className="ghost-sm" value={c.name} onChange={patch(c.id, 'name')} style={{ fontWeight: 600 }} />
                <GhostSelect className="ghost-sm" value={c.type} onChange={patch(c.id, 'type')} options={PRODUCT_TYPES} style={{ color: 'var(--text-2)' }} />
                <GhostSelect className="ghost-sm" value={c.kind} onChange={patch(c.id, 'kind')} options={BILLING_KINDS} style={{ color: 'var(--text-2)' }} />
                <GhostInput className="ghost-sm" value={c.price} onChange={patch(c.id, 'price')} />
                {/* CD-77: only deals in this currency can use the product. */}
                <GhostSelect className="ghost-sm" aria-label={'Currency of ' + c.name} value={itemCurrency(s, c)} onChange={patch(c.id, 'currency')} options={currencyOptions(itemCurrency(s, c))} style={{ color: 'var(--text-2)' }} />
                <GhostInput className="ghost-sm" value={c.vat} onChange={patch(c.id, 'vat')} />
                <span
                  className="hover-underline"
                  title="Show the deals using this"
                  onClick={() => used.length && set({ drill: { kicker: 'Used on', title: c.name, leadIds: used } })}
                  style={{ fontSize: 12.5, color: used.length ? 'var(--brand)' : 'var(--muted)', cursor: used.length ? 'pointer' : 'default' }}
                >
                  {used.length === 0 ? '—' : used.length === 1 ? '1 deal' : used.length + ' deals'}
                </span>
                <RemoveButton
                  box={28}
                  size={14}
                  stroke={1.9}
                  style={{ justifySelf: 'end', borderRadius: 7 }}
                  onClick={() => {
                    if (used.length) return flash(`${c.name} is on ${used.length === 1 ? '1 deal' : used.length + ' deals'}. Remove it there first.`);
                    removeProduct(c.id);
                    flash(c.name + ' removed from the catalog');
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
