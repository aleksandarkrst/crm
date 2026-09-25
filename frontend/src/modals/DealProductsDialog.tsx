import { useState } from 'react';
import { BillingFields } from '../components/BillingFields';
import { Modal, RemoveButton } from '../components/ui';
import { billingText, dealTotals, isRecurring, TAX_MODES } from '../store/dealMath';
import { currencyOptions } from '../store/seed';
import { closeIsoOf, curOf, currencySymbol, defaultStart, leadById, linesOf, moneyExact, num } from '../store/selectors';
import { type DealProductsDraft, useStore } from '../store/store';
import type { DealDiscount, DealLine, DiscountKind, Installment, TaxMode } from '../store/types';

const LINE_COLS = 'minmax(170px,2fr) 140px 110px 90px 130px 70px 110px 30px';
let seq = 0;
const newId = () => `new-${Date.now().toString(36)}-${++seq}`;

/**
 * "Add products to deal" (CD-83): the deal's currency, whether prices include tax, its products
 * (each with its billing), discounts on the one-time products, and installments. Everything is
 * saved together; the deal value is the contract value without tax.
 */
export function DealProductsDialog() {
  const { s, set, flash, saveDealProducts } = useStore();
  const lead = leadById(s, s.dealProductsId);
  const [draft, setDraft] = useState<DealProductsDraft | null>(() =>
    lead
      ? {
          currency: curOf(s, lead).currency,
          taxMode: lead.taxMode,
          lines: linesOf(s, lead).map((l) => ({ ...l })),
          discounts: lead.discounts.map((d) => ({ ...d })),
          installments: lead.installments.map((i) => ({ ...i })),
        }
      : null,
  );
  const [tab, setTab] = useState<'products' | 'installments'>(lead?.installments.length ? 'installments' : 'products');
  const [billingOpen, setBillingOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => set({ dealProductsId: null });
  if (!lead || !draft) return null;

  const cur = { ...curOf(s, lead), currency: draft.currency };
  const sym = currencySymbol(cur);
  const fmt = (n: number) => moneyExact(n, cur);
  const totals = dealTotals(draft.lines, draft.taxMode, draft.discounts);
  const recurring = draft.lines.some(isRecurring);
  const installmentSum = draft.installments.reduce((a, i) => a + num(i.amount), 0);
  const mismatch = draft.installments.length > 0 && Math.abs(installmentSum - totals.oneTimeTotal) >= 0.01;

  const patch = (fn: (d: DealProductsDraft) => DealProductsDraft) => {
    setError('');
    setDraft((d) => (d ? fn(d) : d));
  };
  const patchLine = (id: string, change: Partial<DealLine>) => patch((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...change } : l)) }));
  const pickProduct = (id: string, itemId: string) => {
    const it = s.catalog.find((c) => c.id === itemId);
    if (!it) return;
    patchLine(id, { itemId, price: it.price, qty: it.qty, vat: it.vat, frequency: it.frequency, cycles: it.cycles, description: it.description });
  };
  const addLine = () => {
    const it = s.catalog[0];
    if (!it) return flash('Add a product to the catalog first');
    patch((d) => ({
      ...d,
      lines: [
        ...d.lines,
        { id: newId(), itemId: it.id, description: it.description, qty: it.qty, price: it.price, discountKind: 'percent', discount: 0, vat: it.vat, frequency: it.frequency, cycles: it.cycles, start: defaultStart(lead) },
      ],
    }));
  };
  const patchDiscount = (id: string, change: Partial<DealDiscount>) => patch((d) => ({ ...d, discounts: d.discounts.map((x) => (x.id === id ? { ...x, ...change } : x)) }));
  const patchInstallment = (id: string, change: Partial<Installment>) => patch((d) => ({ ...d, installments: d.installments.map((x) => (x.id === id ? { ...x, ...change } : x)) }));

  const submit = async () => {
    if (draft.lines.some((l) => !l.itemId)) return setError('Pick a product on every line.');
    if (draft.lines.some((l) => l.discountKind === 'percent' && num(l.discount) > 100) || draft.discounts.some((x) => x.kind === 'percent' && num(x.value) > 100)) return setError('A percentage discount is at most 100%.');
    if (draft.installments.length && recurring) return setError('Installments are for deals with one-time products only. Remove the recurring products or the installments.');
    const minIso = closeIsoOf(lead);
    if (minIso && (draft.lines.some((l) => l.start && l.start < minIso) || draft.installments.some((i) => i.date && i.date < minIso))) return setError('Billing dates must fall after the closing date.');
    setBusy(true);
    const ok = await saveDealProducts(lead.id, draft);
    setBusy(false);
    if (ok) {
      close();
      flash('Products saved · deal value ' + moneyExact(totals.subtotal, cur));
    }
  };

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      className="composer-tab"
      onClick={() => setTab(key)}
      style={{ padding: '10px 2px', fontSize: 13.5, fontWeight: tab === key ? 600 : 500, color: tab === key ? 'var(--ink)' : 'var(--text-2)', borderBottom: `2px solid ${tab === key ? 'var(--brand)' : 'transparent'}`, marginBottom: -1 }}
    >
      {label}
    </button>
  );

  return (
    <Modal maxWidth={1060} z={46} gap={16}>
      <div>
        <div className="modal-title" style={{ fontSize: 20 }}>
          Add products to deal · {lead.title || lead.company}
        </div>
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 22, borderBottom: '1px solid var(--divider)' }}>
        {tabBtn('products', `Products (${draft.lines.length})`)}
        {tabBtn('installments', `Installments (${draft.installments.length})`)}
      </div>

      {tab === 'products' ? (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="form-label" style={{ minWidth: 200 }}>
              Deal currency
              <select className="form-input" value={draft.currency} onChange={(e) => patch((d) => ({ ...d, currency: e.target.value }))}>
                {currencyOptions(draft.currency).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label" style={{ minWidth: 180 }}>
              Amounts are
              <select className="form-input" value={draft.taxMode} onChange={(e) => patch((d) => ({ ...d, taxMode: e.target.value as TaxMode }))}>
                {TAX_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ minWidth: 900 }}>
              <div className="table-head" style={{ gridTemplateColumns: LINE_COLS }}>
                {['Product', 'Billing start', 'Price', 'Quantity', 'Discount', 'Tax %', 'Amount', ''].map((h, i) => (
                  <span key={i} className="th" style={i === 6 ? { textAlign: 'right' } : undefined}>
                    {h}
                  </span>
                ))}
              </div>
              {draft.lines.length === 0 && <div className="empty-state">No products on this deal yet.</div>}
              {draft.lines.map((l, i) => {
                const it = s.catalog.find((c) => c.id === l.itemId);
                const t = totals.lines[i]!;
                return (
                  <div key={l.id} data-testid="deal-line" style={{ borderBottom: '1px solid var(--divider)', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: LINE_COLS, gap: 12, alignItems: 'center' }}>
                      <select className="form-input" aria-label="Product" value={l.itemId} onChange={(e) => pickProduct(l.id, e.target.value)}>
                        {!it && <option value={l.itemId}>Removed product</option>}
                        {s.catalog.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input className="form-input" type="date" aria-label="Billing start date" min={closeIsoOf(lead) || undefined} value={l.start} onChange={(e) => patchLine(l.id, { start: e.target.value })} />
                      <input className="form-input" inputMode="decimal" aria-label="Price" value={l.price} onChange={(e) => patchLine(l.id, { price: e.target.value })} />
                      <input className="form-input" inputMode="decimal" aria-label="Quantity" title={it?.unit || undefined} value={l.qty} onChange={(e) => patchLine(l.id, { qty: e.target.value })} />
                      <span style={{ display: 'flex', gap: 4 }}>
                        <input className="form-input" inputMode="decimal" aria-label="Discount" value={l.discount} onChange={(e) => patchLine(l.id, { discount: e.target.value })} style={{ minWidth: 0, flex: 1 }} />
                        <select className="form-input" aria-label="Discount type" value={l.discountKind} onChange={(e) => patchLine(l.id, { discountKind: e.target.value as DiscountKind })} style={{ padding: '6px 4px' }}>
                          <option value="percent">%</option>
                          <option value="amount">{sym}</option>
                        </select>
                      </span>
                      <input className="form-input" inputMode="decimal" aria-label="Tax %" value={l.vat} disabled={draft.taxMode === 'none'} onChange={(e) => patchLine(l.id, { vat: e.target.value })} />
                      <span data-testid="line-amount" style={{ fontSize: 13.5, fontWeight: 600, textAlign: 'right' }}>
                        {fmt(t.perCycle)}
                      </span>
                      <RemoveButton title="Remove product" box={28} size={14} stroke={1.9} style={{ borderRadius: 7 }} onClick={() => patch((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))} />
                    </div>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-2)' }}>
                      <button type="button" className="btn-plain" data-testid="line-billing" style={{ fontSize: 12.5, padding: '5px 10px', borderRadius: 7 }} onClick={() => setBillingOpen(billingOpen === l.id ? null : l.id)}>
                        {billingText(l.frequency, l.cycles)} ✎
                      </button>
                      <input className="form-input" aria-label="Description" placeholder="Description" value={l.description} maxLength={2000} onChange={(e) => patchLine(l.id, { description: e.target.value })} style={{ flex: '1 1 240px', padding: '6px 9px', fontSize: 12.5 }} />
                      <span>
                        TCV <strong style={{ color: 'var(--ink)' }}>{fmt(t.tcv)}</strong>
                      </span>
                    </div>
                    {billingOpen === l.id && (
                      <div className="hint-box" style={{ maxWidth: 360 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>Edit billing frequency</div>
                        <BillingFields idPrefix={'line-' + l.id} frequency={l.frequency} cycles={l.cycles} onChange={(frequency, cycles) => patchLine(l.id, { frequency, cycles })} />
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ padding: '10px 16px' }}>
                <button type="button" className="btn-plain" onClick={addLine}>
                  + Product
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="card-title">Additional discounts</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Apply to one-time products only.</div>
              {draft.discounts.map((x) => (
                <div key={x.id} data-testid="deal-discount" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="form-input" aria-label="Discount name" placeholder="e.g. Loyalty" value={x.label} maxLength={100} onChange={(e) => patchDiscount(x.id, { label: e.target.value })} style={{ flex: 2, minWidth: 0 }} />
                  <input className="form-input" inputMode="decimal" aria-label="Discount value" value={x.value} onChange={(e) => patchDiscount(x.id, { value: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                  <select className="form-input" aria-label="Discount kind" value={x.kind} onChange={(e) => patchDiscount(x.id, { kind: e.target.value as DiscountKind })}>
                    <option value="percent">%</option>
                    <option value="amount">{sym}</option>
                  </select>
                  <RemoveButton title="Remove discount" box={28} size={14} stroke={1.9} style={{ borderRadius: 7 }} onClick={() => patch((d) => ({ ...d, discounts: d.discounts.filter((y) => y.id !== x.id) }))} />
                </div>
              ))}
              <div>
                <button type="button" className="btn-plain" onClick={() => patch((d) => ({ ...d, discounts: [...d.discounts, { id: newId(), label: '', kind: 'percent', value: '' }] }))}>
                  + Add discount
                </button>
              </div>
            </div>
            <DealSummary totals={totals} fmt={fmt} taxMode={draft.taxMode} />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recurring ? (
            <div className="hint-box" data-testid="installments-blocked">
              Installments are for deals with one-time products only. This deal has recurring products: they are billed on their own schedule.
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Split the one-time products into dated payments. With installments, the deal can't have recurring products.</div>
          )}
          {draft.installments.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ minWidth: 560 }}>
                <div className="table-head" style={{ gridTemplateColumns: 'minmax(0,2fr) 160px 150px 30px' }}>
                  {['Description', 'Billing date', 'Amount', ''].map((h, i) => (
                    <span key={i} className="th">
                      {h}
                    </span>
                  ))}
                </div>
                {draft.installments.map((x, i) => (
                  <div key={x.id} data-testid="installment" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 160px 150px 30px', gap: 12, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid var(--divider)' }}>
                    <input className="form-input" aria-label="Installment description" placeholder={`Installment ${i + 1}`} value={x.description} maxLength={200} onChange={(e) => patchInstallment(x.id, { description: e.target.value })} />
                    <input className="form-input" type="date" aria-label="Billing date" min={closeIsoOf(lead) || undefined} value={x.date} onChange={(e) => patchInstallment(x.id, { date: e.target.value })} />
                    <input className="form-input" inputMode="decimal" aria-label="Installment amount" value={x.amount} onChange={(e) => patchInstallment(x.id, { amount: e.target.value })} />
                    <RemoveButton title="Remove installment" box={28} size={14} stroke={1.9} style={{ borderRadius: 7 }} onClick={() => patch((d) => ({ ...d, installments: d.installments.filter((y) => y.id !== x.id) }))} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="btn-plain"
              disabled={recurring}
              onClick={() => {
                const left = Math.max(0, Math.round((totals.oneTimeTotal - installmentSum) * 100) / 100);
                patch((d) => ({ ...d, installments: [...d.installments, { id: newId(), description: '', date: d.installments.at(-1)?.date || defaultStart(lead), amount: left }] }));
              }}
            >
              + Installment
            </button>
            {draft.installments.length > 0 && (
              <div style={{ fontSize: 13, textAlign: 'right' }}>
                Total installments <strong>{fmt(installmentSum)}</strong> of {fmt(totals.oneTimeTotal)}
                {mismatch && (
                  <div data-testid="installments-mismatch" style={{ color: 'var(--warn)', fontSize: 12.5, marginTop: 4 }}>
                    The installments add up to {fmt(installmentSum)}, but the one-time products come to {fmt(totals.oneTimeTotal)} with tax.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function DealSummary({ totals, fmt, taxMode }: { totals: ReturnType<typeof dealTotals>; fmt: (n: number) => string; taxMode: TaxMode }) {
  const row = (label: string, value: string, strong = false, testId?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: strong ? 14 : 13, fontWeight: strong ? 600 : 400 }}>
      <span style={{ color: strong ? 'var(--ink)' : 'var(--text-2)' }}>{label}</span>
      <span data-testid={testId}>{value}</span>
    </div>
  );
  return (
    <div className="hint-box" style={{ flex: '0 1 320px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="card-title" style={{ color: 'var(--ink)' }}>
        Summary
      </div>
      {totals.discount > 0 && row('Discounts', '−' + fmt(totals.discount))}
      {row('Subtotal excluding tax', fmt(totals.subtotal), false, 'summary-subtotal')}
      {taxMode !== 'none' && row('Tax', fmt(totals.tax))}
      {row('Total with tax', fmt(totals.total), true, 'summary-total')}
      {totals.mrr > 0 && <div style={{ fontSize: 12, color: 'var(--text-2)' }}>MRR {fmt(totals.mrr)} · ARR {fmt(totals.arr)} · ACV {fmt(totals.acv)}</div>}
    </div>
  );
}
