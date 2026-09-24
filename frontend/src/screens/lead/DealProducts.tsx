import { RemoveButton } from '../../components/ui';
import { Chevron } from '../../components/ui';
import { SCHEDULE_TYPES } from '../../store/seed';
import { closeIsoOf, curOf, grossOf, itemById, linesOf, money, monthLabel, netOf, num, shiftIso, vatOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { DealLine, Lead } from '../../store/types';

const LINE_COLS = 'minmax(0,2.2fr) 78px 104px 74px 104px 34px';
const PAY_COLS = 'minmax(0,1.6fr) 96px 132px 100px';

/** Products & services on a deal, each with a payment schedule. Payments fall after the closing date. */
export function DealProducts({ lead }: { lead: Lead }) {
  const store = useStore();
  const { s } = store;
  const lines = linesOf(s, lead);
  const net = netOf(lines);
  const vat = vatOf(lines);
  const closeIso = closeIsoOf(lead);
  const c = curOf(s, lead);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div className="card-title">Products &amp; services</div>
          <div className="card-sub" style={{ marginTop: 3 }}>
            {lines.length === 0 ? 'Nothing priced yet' : `${lines.length}${lines.length === 1 ? ' line · ' : ' lines · '}${money(net, c)} net`}
          </div>
        </div>
        {!!closeIso && (
          <button type="button" className="btn-plain" onClick={() => store.addDealLine(lead)}>
            Add line
          </button>
        )}
      </div>

      {!closeIso && (
        <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 9, padding: '12px 14px', lineHeight: 1.5 }}>
          Set the closing date on the deal first. Products and services are priced against it, and every payment has to fall after it.
        </div>
      )}
      {lines.length === 0 && !!closeIso && (
        <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', padding: '20px 8px', border: '1px dashed var(--dashed)', borderRadius: 9 }}>No products or services on this deal yet. Add a line to set the amount.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {lines.map((ln) => (
          <Line key={ln.id} lead={lead} line={ln} minDate={closeIso} />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 26, marginTop: 16, flexWrap: 'wrap' }}>
        <Total label="Deal amount, net" value={money(net, c)} />
        <Total label="VAT" value={money(vat, c)} color="var(--text-2)" />
        <Total label="Total incl. VAT" value={money(net + vat, c)} color="var(--brand)" />
      </div>
    </div>
  );
}

function Total({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <span className="mini-caps" style={{ fontSize: 10 }}>
        {label}
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function Line({ lead, line: ln, minDate }: { lead: Lead; line: DealLine; minDate: string }) {
  const store = useStore();
  const { s } = store;
  const it = itemById(s, ln.itemId);
  const qtyLabel = it.kind === 'Hourly' ? 'Hours' : it.kind === 'Monthly' ? 'Months' : it.kind === 'Yearly' ? 'Years' : 'Qty';
  const priceLabel = it.kind === 'Hourly' ? 'Rate / h' : it.kind === 'Monthly' ? 'Per month' : it.kind === 'Yearly' ? 'Per year' : 'Unit price';
  const set = (key: keyof DealLine) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => store.patchLine(lead.id, ln.id, key, e.target.value);
  const gross = grossOf(ln);
  const c = curOf(s, lead);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: LINE_COLS, gap: 10, alignItems: 'center', padding: '10px 12px' }}>
        <div style={{ position: 'relative', minWidth: 0 }}>
          <select className="ghost ghost-sm" value={ln.itemId} onChange={set('itemId')} style={{ appearance: 'none', WebkitAppearance: 'none', paddingRight: 24, fontWeight: 600 }}>
            {s.catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.kind}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--muted)', display: 'flex' }}>
            <Chevron />
          </span>
        </div>
        <LineInput label={qtyLabel} value={ln.qty} onChange={set('qty')} />
        <LineInput label={priceLabel} value={ln.price} onChange={set('price')} />
        <LineInput label="VAT %" value={ln.vat} onChange={set('vat')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', minWidth: 0 }}>
          <span className="mini-caps">Line total</span>
          <span style={{ fontSize: 13, fontWeight: 600, padding: '6px 0' }}>{money(gross, c)}</span>
        </div>
        <RemoveButton title="Remove line" box={28} size={14} stroke={1.9} style={{ justifySelf: 'end', borderRadius: 7 }} onClick={() => store.removeDealLine(lead.id, ln.id)} />
      </div>

      <div style={{ borderTop: '1px solid var(--divider)', background: 'var(--panel)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 190 }}>
            <span className="mini-caps">Payment schedule</span>
            <select className="pay-input" value={ln.schedule} onChange={set('schedule')}>
              {SCHEDULE_TYPES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="mini-caps">{ln.schedule === 'Full amount on one date' ? 'Due date' : 'First payment'}</span>
            <input type="date" className="pay-input" min={minDate} value={ln.start} onChange={set('start')} />
          </label>
          {ln.schedule === 'Equal monthly instalments' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 110 }}>
              <span className="mini-caps">Instalments</span>
              <input className="pay-input" value={ln.months} onChange={set('months')} />
            </label>
          )}
          {ln.schedule === 'Custom milestones' && (
            <button type="button" className="btn-plain" style={{ fontSize: 12.5, fontWeight: 400, padding: '8px 12px', borderRadius: 7 }} onClick={() => store.addMilestone(lead.id, ln.id)}>
              Add milestone
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Payments lead={lead} line={ln} gross={gross} minDate={minDate} />
        </div>
      </div>
    </div>
  );
}

function LineInput({ label, value, onChange }: { label: string; value: string | number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span className="mini-caps">{label}</span>
      <input className="ghost ghost-sm" value={value} onChange={onChange} />
    </label>
  );
}

function Payments({ lead, line: ln, gross, minDate }: { lead: Lead; line: DealLine; gross: number; minDate: string }) {
  const store = useStore();
  const c = curOf(store.s, lead);
  const row = (key: string | number, cells: React.ReactNode) => (
    <div key={key} style={{ display: 'grid', gridTemplateColumns: PAY_COLS, gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--divider)' }}>
      {cells}
    </div>
  );
  const readonly = (label: string, pct: string, when: string, amount: string) =>
    row(
      label,
      <>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{label}</span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{pct}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{when}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{amount}</span>
      </>,
    );

  if (ln.schedule === 'Custom milestones') {
    return (
      <>
        {(ln.milestones || []).map((m, i) =>
          row(
            i,
            <>
              <input className="ghost ghost-sm" value={m.label} onChange={(e) => store.patchMilestone(lead.id, ln.id, i, 'label', e.target.value)} />
              <input className="ghost ghost-sm" value={m.pct} onChange={(e) => store.patchMilestone(lead.id, ln.id, i, 'pct', e.target.value)} />
              <input type="date" className="ghost" min={minDate} value={m.date || shiftIso(ln.start, i)} onChange={(e) => store.patchMilestone(lead.id, ln.id, i, 'date', e.target.value)} style={{ padding: '5px 7px', fontSize: 12.5, color: 'var(--text-2)' }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{money((gross * num(m.pct)) / 100, c)}</span>
            </>,
          ),
        )}
      </>
    );
  }
  if (ln.schedule === 'Equal monthly instalments') {
    const n = Math.max(1, Math.round(num(ln.months)) || 1);
    return <>{Array.from({ length: n }, (_, i) => readonly(`Instalment ${i + 1} of ${n}`, Math.round(100 / n) + '%', monthLabel(ln.start, i), money(gross / n, c)))}</>;
  }
  if (ln.schedule === 'Recurring subscription') return readonly('Every month, no end date', '—', 'from ' + monthLabel(ln.start, 0), money(gross, c) + ' / mo');
  return readonly('Full amount', '100%', monthLabel(ln.start, 0), money(gross, c));
}
