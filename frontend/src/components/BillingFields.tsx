import { FREQUENCIES } from '../store/dealMath';
import type { BillingFrequency } from '../store/types';

/**
 * Billing frequency and, for recurring billing, how long it runs (CD-83): "Renew until canceled"
 * or a fixed number of billing cycles. Used by the product dialog and the deal's products dialog.
 */
export function BillingFields({ frequency, cycles, onChange, idPrefix }: { frequency: BillingFrequency; cycles: number | null; onChange: (frequency: BillingFrequency, cycles: number | null) => void; idPrefix: string }) {
  const recurring = frequency !== 'one_time';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="form-label">
        Billing frequency
        <select className="form-input" value={frequency} onChange={(e) => onChange(e.target.value as BillingFrequency, e.target.value === 'one_time' ? null : cycles)}>
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {recurring && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="form-label" style={{ padding: 0, marginBottom: 6 }}>
            Billing cycles
          </legend>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="radio" name={idPrefix + '-cycles'} checked={cycles === null} onChange={() => onChange(frequency, null)} />
            Renew until canceled
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
            <input type="radio" name={idPrefix + '-cycles'} checked={cycles !== null} onChange={() => onChange(frequency, cycles ?? 12)} />
            Fixed number of billing cycles
            {cycles !== null && (
              <input
                className="form-input"
                aria-label="Number of billing cycles"
                type="number"
                min={1}
                max={1000}
                value={cycles}
                onChange={(e) => onChange(frequency, Math.min(1000, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
                style={{ width: 90, padding: '6px 9px' }}
              />
            )}
          </label>
        </fieldset>
      )}
    </div>
  );
}
