import { Icon } from '../../components/icons';
import { billingText } from '../../store/dealMath';
import { curOf, isoLabel, itemById, linesOf, moneyExact, num, totalsOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { Lead } from '../../store/types';

/**
 * What the deal sells (CD-83): each product with its quantity, amount and billing, and the
 * installments when there are any. The pencil opens the products dialog.
 */
export function DealProducts({ lead }: { lead: Lead }) {
  const { s, openDealProducts } = useStore();
  const lines = linesOf(s, lead);
  const totals = totalsOf(s, lead);
  const cur = curOf(s, lead);
  const installments = lead.installments;
  const dates = installments.map((i) => i.date).filter(Boolean).sort();

  return (
    <div className="card card-pad" data-testid="deal-products">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Products ({lines.length})</span>
        <button type="button" className="icon-btn" aria-label="Edit products" title="Edit products" onClick={() => openDealProducts(lead.id)} style={{ padding: 6, borderRadius: 7, color: 'var(--text-2)' }}>
          <Icon name="pencil" />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        {lines.length === 0 ? (
          <div className="empty-dashed">
            No products yet.{' '}
            <button type="button" onClick={() => openDealProducts(lead.id)} style={{ border: 0, background: 'transparent', color: 'var(--brand)', cursor: 'pointer', padding: 0, font: 'inherit' }}>
              + Products
            </button>
          </div>
        ) : (
          lines.map((ln, i) => {
            const it = itemById(s, ln.itemId);
            const t = totals.lines[i]!;
            return (
              <div key={ln.id} data-testid="deal-product" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>
                    {num(ln.qty)}x {it.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)' }}>{billingText(ln.frequency, ln.cycles)}</span>
                </span>
                <span style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{moneyExact(t.perCycle, cur)}</span>
              </div>
            );
          })
        )}
        {installments.length > 0 && (
          <div data-testid="deal-installments" className="hint-box" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 12.5 }}>
            <span>Installments</span>
            <strong style={{ textAlign: 'right' }}>{installments.length}</strong>
            <span>Total installments value</span>
            <strong style={{ textAlign: 'right' }}>{moneyExact(installments.reduce((a, x) => a + num(x.amount), 0), cur)}</strong>
            <span>Start date</span>
            <strong style={{ textAlign: 'right' }}>{dates[0] ? isoLabel(dates[0]) : '—'}</strong>
            <span>End date</span>
            <strong style={{ textAlign: 'right' }}>{dates.at(-1) ? isoLabel(dates.at(-1)!) : '—'}</strong>
          </div>
        )}
        {lines.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: 'var(--text-2)', borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
            <span>Total with tax</span>
            <strong style={{ color: 'var(--ink)' }}>{moneyExact(totals.total, cur)}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
