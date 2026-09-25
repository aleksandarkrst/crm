import { useState } from 'react';
import { BillingFields } from '../components/BillingFields';
import { Modal, ModalHeader } from '../components/ui';
import { linesOf, localeFor, num, plainAmount } from '../store/selectors';
import { type ProductDraft, useStore } from '../store/store';

const UNITS = ['hour', 'day', 'seat', 'license', 'month', 'piece', 'project'];

/**
 * A product or service (CD-83): opened from the Products list to edit one, or to add one. Prices
 * have no currency; a deal gives them its own.
 */
export function ProductModal() {
  const { s, set, flash, saveProduct, removeProduct, canDelete } = useStore();
  const editing = s.catalog.find((c) => c.id === s.productEditId) ?? null;
  const [p, setP] = useState<ProductDraft>(() =>
    editing
      ? { name: editing.name, description: editing.description, unit: editing.unit, price: String(editing.price), qty: String(editing.qty), vat: String(editing.vat), frequency: editing.frequency, cycles: editing.cycles }
      : { name: '', description: '', unit: '', price: '', qty: '1', vat: '20', frequency: 'one_time', cycles: null },
  );
  const [busy, setBusy] = useState(false);
  const close = () => set({ productOpen: false, productEditId: null });
  const field = (k: keyof ProductDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP((x) => ({ ...x, [k]: e.target.value }));
  const locale = localeFor(s.workspace.currency);
  const usedOn = editing ? s.leads.filter((l) => linesOf(s, l).some((ln) => ln.itemId === editing.id)).length : 0;

  const submit = async () => {
    const name = p.name.trim();
    if (!name) return flash('Give the product a name first');
    setBusy(true);
    const ok = await saveProduct(editing?.id ?? null, { ...p, name });
    setBusy(false);
    if (!ok) return;
    close();
    flash(editing ? name + ' saved' : name + ' added to the catalog');
  };
  const onDelete = () => {
    if (!editing) return;
    if (usedOn) return flash(`${editing.name} is on ${usedOn === 1 ? '1 deal' : usedOn + ' deals'}. Remove it there first.`);
    if (!window.confirm(`Delete ${editing.name} from the catalog?`)) return;
    removeProduct(editing.id);
    close();
    flash(editing.name + ' removed from the catalog');
  };

  return (
    <Modal maxWidth={560} z={46} gap={18} onBackdrop={close}>
      <ModalHeader title={editing ? editing.name : 'New product or service'} sub="Deals start from these values and can change them. Prices are in the currency of the deal." />
      <label className="form-label">
        Name
        <input className="form-input" autoFocus={!editing} placeholder="e.g. Brand identity sprint" value={p.name} onChange={field('name')} />
      </label>
      <label className="form-label">
        Description
        <textarea className="form-input" rows={2} maxLength={2000} placeholder="What the customer gets" value={p.description} onChange={field('description')} />
      </label>
      <div className="product-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <label className="form-label">
          Unit price
          <input className="form-input" inputMode="decimal" placeholder="6500" value={p.price} onChange={field('price')} />
        </label>
        <label className="form-label">
          Unit
          <input className="form-input" list="product-units" placeholder="e.g. hour" maxLength={40} value={p.unit} onChange={field('unit')} />
          <datalist id="product-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label className="form-label">
          Quantity
          <input className="form-input" inputMode="decimal" value={p.qty} onChange={field('qty')} />
        </label>
        <div className="form-label">
          Price
          <span data-testid="product-price" className="form-input" style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
            {plainAmount(num(p.price) * (num(p.qty) || 1), locale)}
          </span>
        </div>
        <label className="form-label">
          Tax %
          <input className="form-input" inputMode="decimal" placeholder="20" value={p.vat} onChange={field('vat')} />
        </label>
      </div>
      <BillingFields idPrefix="product" frequency={p.frequency} cycles={p.cycles} onChange={(frequency, cycles) => setP((x) => ({ ...x, frequency, cycles }))} />
      <div className="modal-actions" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>
          {editing && canDelete && (
            <button type="button" className="btn btn-secondary" style={{ color: 'var(--danger)' }} onClick={onDelete}>
              Delete
            </button>
          )}
        </span>
        <span style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add to catalog'}
          </button>
        </span>
      </div>
    </Modal>
  );
}
