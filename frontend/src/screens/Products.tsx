import { useState } from 'react';
import { DataActions } from '../components/DataActions';
import { FilterBar } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { billingText, FREQUENCIES } from '../store/dealMath';
import { productsCsv } from '../store/exportCsv';
import { linesOf, localeFor, plainAmount } from '../store/selectors';
import { useStore } from '../store/store';

const COLS = 'minmax(0,2fr) 0.9fr 0.7fr 0.9fr 0.6fr 1.1fr 0.7fr';
const ANY = 'Billing frequency';

/** The catalog (CD-83): a row opens the product in a dialog. */
export function Products() {
  const { s, set, openProduct } = useStore();
  const [frequency, setFrequency] = useState(ANY);

  const usage: Record<string, string[]> = {};
  s.leads.forEach((l) => linesOf(s, l).forEach((ln) => (usage[ln.itemId] ||= []).push(l.id)));
  const wanted = FREQUENCIES.find((f) => f.label === frequency)?.value;
  const rows = s.catalog.filter((c) => !wanted || c.frequency === wanted);
  const locale = localeFor(s.workspace.currency);

  return (
    <Screen title="Products & services">
      <FilterBar
        chips={[{ value: frequency, options: [ANY, ...FREQUENCIES.map((f) => f.label)], onChange: setFrequency }]}
        dirty={frequency !== ANY}
        onClear={() => {
          setFrequency(ANY);
        }}
        extra={<DataActions type="products" count={rows.length} exportCsv={() => productsCsv(rows)} />}
      />
      {s.catalog.length === 0 ? (
        <EmptyState
          title="No products or services yet"
          text="Your catalog is what you put on deals: products and services with their prices, tax and billing. A deal gives them its currency. Add them one by one, or import a CSV file from the ⋯ menu."
          action={{ label: 'New product', onClick: () => openProduct(null) }}
        />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div className="table-head" style={{ gridTemplateColumns: COLS }}>
              {['Name', 'Unit price', 'Unit', 'Price', 'Tax', 'Billing frequency', 'On deals'].map((h) => (
                <span key={h} className="th">
                  {h}
                </span>
              ))}
            </div>
            {rows.length === 0 && <div className="empty-state">No products match these filters.</div>}
            {rows.map((c) => {
              const used = usage[c.id] || [];
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  data-testid="product-row"
                  className="table-row clickable"
                  style={{ gridTemplateColumns: COLS, alignItems: 'center' }}
                  onClick={() => openProduct(c.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openProduct(c.id))}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{c.name}</span>
                    {c.description && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</span>}
                  </span>
                  <span style={{ fontSize: 13 }}>{plainAmount(c.price, locale)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.unit || '—'}</span>
                  <span style={{ fontSize: 13 }} title={c.qty !== 1 ? `${c.qty} × ${plainAmount(c.price, locale)}` : undefined}>
                    {plainAmount(c.price * c.qty, locale)}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{c.vat}%</span>
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{billingText(c.frequency, c.cycles)}</span>
                  <span
                    className="hover-underline"
                    title="Show the deals using this"
                    onClick={(e) => {
                      if (!used.length) return;
                      e.stopPropagation();
                      set({ drill: { kicker: 'Used on', title: c.name, leadIds: used } });
                    }}
                    style={{ fontSize: 12.5, color: used.length ? 'var(--brand)' : 'var(--muted)', cursor: used.length ? 'pointer' : 'default' }}
                  >
                    {used.length === 0 ? '—' : used.length === 1 ? '1 deal' : used.length + ' deals'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Screen>
  );
}
